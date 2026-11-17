/*
 * Field Reports: an offline-first inspection form.
 *
 *   store.js      IndexedDB (reports and their photo Blobs)
 *   photos.js     canvas resize + JPEG compression
 *   signature.js  Pointer Events signature pad
 *   sw.js         service worker: the app opens with no signal
 *
 * Views are cloned from <template> elements. Navigation uses the History
 * API (?report=<id>), so Back, refresh and bookmarks all work.
 */
(function ($, Store, Photos, SignaturePad) {
  'use strict';

  var MAX_PHOTOS = 6;
  var INSPECTOR_KEY = 'field-reports:inspector';

  var $view = $('#view');
  var current = null;   // the report on screen
  var pad = null;       // SignaturePad while the form is open
  var saveTimer = null;
  var objectUrls = [];
  var firstRender = true;

  /* ---------- Small helpers ---------- */

  function newId() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function two(n) { return (n < 10 ? '0' : '') + n; }

  /* The format <input type="datetime-local"> expects: 2026-11-03T19:20 */
  function localDateTime(d) {
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + 'T' + two(d.getHours()) + ':' + two(d.getMinutes());
  }

  function formatWhen(value) {
    if (!value) return '';
    var d = new Date(value);
    return isNaN(d.getTime()) ? value : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function formatClock(ts) {
    return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function template(id) {
    return document.importNode(document.getElementById(id).content, true);
  }

  function urlFor(blob) {
    var url = URL.createObjectURL(blob);
    objectUrls.push(url);
    return url;
  }

  function releaseUrls() {
    $.each(objectUrls, function (_, url) { URL.revokeObjectURL(url); });
    objectUrls = [];
  }

  function storedInspector() {
    try { return localStorage.getItem(INSPECTOR_KEY) || ''; } catch (e) { return ''; }
  }

  function rememberInspector(name) {
    try { localStorage.setItem(INSPECTOR_KEY, name); } catch (e) { /* not essential */ }
  }

  function mapUrl(loc) {
    return 'https://www.openstreetmap.org/?mlat=' + loc.lat + '&mlon=' + loc.lng + '#map=18/' + loc.lat + '/' + loc.lng;
  }

  function showStorageError(err) {
    $view.empty().append(
      $('<div class="alert alert-danger" role="alert"></div>').text(
        (err && err.message ? err.message + ' ' : '') + 'Reports are saved in your browser, so private browsing or blocked site data can stop them from saving.'
      )
    );
  }

  /* ---------- Routing ---------- */

  function idFromUrl() {
    var match = /[?&]report=([^&]+)/.exec(location.search);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function go(id, replace) {
    var url = id ? '?report=' + encodeURIComponent(id) : location.pathname;
    history[replace ? 'replaceState' : 'pushState']({ id: id }, '', url);
    route();
  }

  function route() {
    return flushSave().then(function () {
      releaseUrls();
      current = null;
      pad = null;
      $view.attr('aria-busy', 'true');
      var id = idFromUrl();
      var loading = id
        ? Store.get(id).then(function (report) {
            if (!report) return go(null, true);
            if (report.status === 'done') showSummary(report);
            else showForm(report);
          })
        : Store.all().then(showList);
      return loading.catch(showStorageError).then(function () {
        $view.attr('aria-busy', 'false');
        // After a navigation, move focus to the new heading so screen readers announce the page.
        if (!firstRender) {
          var heading = $view.find('h1')[0];
          if (heading) {
            heading.setAttribute('tabindex', '-1');
            heading.focus();
          }
        }
        firstRender = false;
      });
    });
  }

  $(window).on('popstate', route);

  $(document).on('click', 'a[href="./"], .report-item', function (e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go($(this).data('id') || null);
  });

  /* ---------- List ---------- */

  function showList(reports) {
    $view.empty().append(template('tpl-list'));
    var $items = $view.find('[data-slot="items"]');
    $view.find('[data-slot="empty"]').prop('hidden', reports.length > 0);

    $.each(reports, function (_, r) {
      var meta = [r.type || 'No type', formatWhen(r.inspectedAt)];
      if (r.photos.length) meta.push(r.photos.length + (r.photos.length === 1 ? ' photo' : ' photos'));
      $items.append(
        $('<a class="list-group-item list-group-item-action report-item"></a>')
          .attr('href', '?report=' + encodeURIComponent(r.id))
          .data('id', r.id)
          .append(
            $('<span class="d-flex justify-content-between gap-3"></span>').append(
              $('<span class="fw-semibold"></span>').text(r.address || 'Untitled report'),
              $('<span class="status"></span>')
                .addClass(r.status === 'done' ? 'status-done' : 'status-draft')
                .text(r.status === 'done' ? 'Finished' : 'Draft')
            ),
            $('<span class="d-block small text-body-secondary"></span>').text(meta.join(' · '))
          )
      );
    });
  }

  $(document).on('click', '[data-action="new"]', function () {
    var report = {
      id: newId(),
      status: 'draft',
      createdAt: Date.now(),
      address: '',
      type: '',
      inspectedAt: localDateTime(new Date()),
      inspector: storedInspector(),
      location: null,
      condition: '',
      notes: '',
      followUp: false,
      priority: '',
      photos: [],
      signature: null,
      typedSignature: ''
    };
    Store.put(report).then(function () { go(report.id); }).catch(showStorageError);
  });

  /* ---------- Form ---------- */

  var FIELDS = {
    address: '#f-address',
    type: '#f-type',
    when: '#f-when',
    inspector: '#f-inspector',
    condition: '#f-c-good',
    priority: '#f-priority',
    photos: '#f-photos',
    signature: '#f-typed'
  };

  var ERROR_KEY = { inspectedAt: 'when', typedSignature: 'signature', followUp: 'priority' };

  function showForm(report) {
    current = report;
    $view.empty().append(template('tpl-form'));
    var $form = $view.find('form');

    $.each(FIELDS, function (key, selector) {
      var $field = $form.find(selector);
      if (key === 'condition') return;
      var described = $field.attr('aria-describedby');
      $field.attr('aria-describedby', (described ? described + ' ' : '') + 'f-' + key + '-error');
    });

    $form.find('[name="address"]').val(report.address);
    $form.find('[name="type"]').val(report.type);
    $form.find('[name="inspectedAt"]').val(report.inspectedAt);
    $form.find('[name="inspector"]').val(report.inspector);
    $form.find('[name="notes"]').val(report.notes);
    $form.find('[name="followUp"]').prop('checked', report.followUp);
    $form.find('[name="priority"]').val(report.priority);
    $form.find('[name="typedSignature"]').val(report.typedSignature);
    $form.find('[name="condition"]').filter(function () { return this.value === report.condition; }).prop('checked', true);

    updateCount();
    toggleFollowUp();
    renderLocation();
    renderPhotos();

    pad = new SignaturePad($view.find('[data-slot="signature"]')[0], function () {
      current.signature = pad.isEmpty() ? null : pad.getStrokes();
      clearError('signature');
      scheduleSave();
    });
    pad.setStrokes(report.signature);
    setSaved(report.updatedAt);
  }

  function updateCount() {
    var length = $view.find('[name="notes"]').val().length;
    $view.find('[data-slot="count"]').text(length + ' / 1000');
  }

  function toggleFollowUp() {
    var on = $view.find('[name="followUp"]').prop('checked');
    $view.find('#f-priority-wrap').prop('hidden', !on);
    $view.find('[name="followUp"]').attr('aria-expanded', String(on));
  }

  $view.on('input change', 'form :input', function () {
    if (!current || !this.name || this.type === 'file') return;
    var name = this.name;
    if (this.type === 'checkbox') current[name] = this.checked;
    else if (this.type === 'radio') { if (this.checked) current[name] = this.value; }
    else current[name] = this.value;

    if (name === 'inspector') rememberInspector(this.value);
    if (name === 'notes') updateCount();
    if (name === 'followUp') toggleFollowUp();
    clearError(ERROR_KEY[name] || name);
    scheduleSave();
  });

  /* ---------- Autosave ---------- */

  function setSaved(ts) {
    $view.find('[data-slot="saved"]').text(ts ? 'Saved ' + formatClock(ts) : '');
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    $view.find('[data-slot="saved"]').text('Saving…');
    saveTimer = setTimeout(saveNow, 400);
  }

  function saveNow() {
    saveTimer = null;
    var report = current;
    if (!report) return Promise.resolve();
    return Store.put(report).then(function () {
      if (report === current) setSaved(report.updatedAt);
    }, function (err) {
      $view.find('[data-slot="saved"]').text('Not saved: ' + err.message);
    });
  }

  function flushSave() {
    if (!saveTimer) return Promise.resolve();
    clearTimeout(saveTimer);
    return saveNow();
  }

  // Save before the tab is hidden or closed; phones often kill background tabs.
  $(document).on('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushSave();
  });

  /* ---------- Geolocation ---------- */

  function renderLocation(problem) {
    var $slot = $view.find('[data-slot="location"]').empty().removeClass('text-danger');
    if (problem) {
      $slot.addClass('text-danger').text(problem);
      return;
    }
    var loc = current.location;
    if (!loc) return;
    $slot.append(
      document.createTextNode(loc.lat + ', ' + loc.lng + ' (±' + loc.accuracy + ' m) · '),
      $('<a target="_blank" rel="noopener"></a>').attr('href', mapUrl(loc)).text('View map')
    );
    $view.find('[data-action="locate"]').text('Update location');
  }

  $view.on('click', '[data-action="locate"]', function () {
    var $button = $(this);
    if (!navigator.geolocation) {
      renderLocation('This browser cannot share its location.');
      return;
    }
    var label = $button.text();
    $button.prop('disabled', true).text('Finding you…');
    var report = current;
    navigator.geolocation.getCurrentPosition(function (pos) {
      $button.prop('disabled', false);
      if (report !== current) return;
      current.location = {
        lat: +pos.coords.latitude.toFixed(6),
        lng: +pos.coords.longitude.toFixed(6),
        accuracy: Math.round(pos.coords.accuracy),
        at: Date.now()
      };
      renderLocation();
      scheduleSave();
    }, function (err) {
      $button.prop('disabled', false).text(label);
      renderLocation(err.code === 1
        ? 'Location access is off for this site. The report can be finished without it.'
        : 'Your location could not be found. Try again in a minute.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });

  /* ---------- Photos ---------- */

  function renderPhotos() {
    releaseUrls();
    var $list = $view.find('[data-slot="photos"]').empty();
    $.each(current.photos, function (i, photo) {
      $list.append(
        $('<li class="photo"></li>').append(
          $('<img>').attr({ src: urlFor(photo.blob), alt: 'Photo ' + (i + 1), width: photo.width, height: photo.height }),
          $('<span class="photo-meta"></span>').text(Photos.formatBytes(photo.bytes)),
          $('<button type="button" class="btn btn-sm btn-light photo-remove"></button>')
            .attr('aria-label', 'Remove photo ' + (i + 1))
            .data('id', photo.id)
            .text('Remove')
        )
      );
    });
  }

  function addPhotos(fileList) {
    var $note = $view.find('[data-slot="photo-note"]');
    var files = $.grep(Array.prototype.slice.call(fileList || []), function (f) { return /^image\//.test(f.type); });
    var room = MAX_PHOTOS - current.photos.length;
    if (!files.length) { $note.text('Only image files can be added.'); return; }
    if (room <= 0) { $note.text('A report can have up to ' + MAX_PHOTOS + ' photos.'); return; }

    var skipped = Math.max(0, files.length - room);
    files = files.slice(0, room);
    $note.text('Processing ' + files.length + (files.length === 1 ? ' photo…' : ' photos…'));

    var report = current;
    var added = [];
    var failed = [];
    // One at a time: decoding several 12-megapixel photos at once can run a phone out of memory.
    var chain = Promise.resolve();
    $.each(files, function (_, file) {
      chain = chain.then(function () {
        return Photos.shrink(file).then(function (photo) { added.push(photo); }, function () { failed.push(file.name); });
      });
    });

    chain.then(function () {
      if (report !== current) return;
      current.photos = current.photos.concat(added);
      renderPhotos();
      clearError('photos');
      scheduleSave();

      var parts = [];
      if (added.length) {
        var before = 0;
        var after = 0;
        $.each(added, function (_, p) { before += p.originalBytes; after += p.bytes; });
        parts.push((added.length === 1 ? '1 photo' : added.length + ' photos') + ' added, ' + Photos.formatBytes(before) + ' shrunk to ' + Photos.formatBytes(after) + '.');
      }
      if (failed.length) parts.push(failed.join(', ') + ' could not be read.');
      if (skipped) parts.push('A report can have up to ' + MAX_PHOTOS + ' photos.');
      $note.text(parts.join(' '));
    });
  }

  $view.on('change', '#f-photos', function () {
    addPhotos(this.files);
    this.value = '';
  });

  $view.on('click', '.photo-remove', function () {
    var id = $(this).data('id');
    var index = -1;
    current.photos = $.grep(current.photos, function (p, i) {
      if (p.id === id) index = i;
      return p.id !== id;
    });
    renderPhotos();
    scheduleSave();
    $view.find('[data-slot="photo-note"]').text('Photo removed.');
    var $next = $view.find('.photo-remove').eq(Math.min(index, current.photos.length - 1));
    ($next.length ? $next : $view.find('#f-photos')).trigger('focus');
  });

  // Drag photos from the desktop onto the drop zone (HTML5 drag and drop with files).
  $view.on('dragenter dragover', '[data-slot="dropzone"]', function (e) {
    e.preventDefault();
    e.originalEvent.dataTransfer.dropEffect = 'copy';
    $(this).addClass('is-over');
  });
  $view.on('dragleave drop', '[data-slot="dropzone"]', function (e) {
    if (e.type === 'dragleave' && $.contains(this, e.originalEvent.relatedTarget)) return;
    $(this).removeClass('is-over');
  });
  $view.on('drop', '[data-slot="dropzone"]', function (e) {
    e.preventDefault();
    addPhotos(e.originalEvent.dataTransfer.files);
  });
  // A file dropped anywhere else would make the browser open it and leave the form.
  $(window).on('dragover drop', function (e) {
    if (!$(e.target).closest('[data-slot="dropzone"]').length) e.preventDefault();
  });

  /* ---------- Signature ---------- */

  $view.on('click', '[data-action="clear-signature"]', function () {
    if (pad) pad.clear();
  });

  /* ---------- Validation ---------- */

  function validate(r) {
    var errors = [];
    function add(key, text) { errors.push({ key: key, text: text }); }

    if (!$.trim(r.address)) add('address', 'Enter the site address');
    if (!r.type) add('type', 'Choose an inspection type');
    if (!r.inspectedAt) add('when', 'Enter the date and time of the inspection');
    else if (new Date(r.inspectedAt).getTime() > Date.now() + 5 * 60 * 1000) add('when', 'The inspection time can’t be in the future');
    if (!$.trim(r.inspector)) add('inspector', 'Enter the inspector’s name');
    if (!r.condition) add('condition', 'Choose the condition');
    if (r.followUp && !r.priority) add('priority', 'Choose a follow-up priority');
    if (r.condition === 'Hazard' && !r.photos.length) add('photos', 'Add at least one photo of the hazard');
    if (!r.signature && !$.trim(r.typedSignature)) add('signature', 'Sign the report or type your full name');
    return errors;
  }

  function clearError(key) {
    var $field = $view.find(FIELDS[key]);
    if (key === 'condition') $field = $view.find('[name="condition"]');
    $field.removeClass('is-invalid').removeAttr('aria-invalid');
    $view.find('#f-' + key + '-error').text('');
    // Fixed problems drop off the summary at the top too.
    var $summary = $view.find('[data-slot="errors"]');
    $summary.find('li[data-key="' + key + '"]').remove();
    if (!$summary.find('li').length) $summary.prop('hidden', true);
  }

  function showErrors(errors) {
    var $summary = $view.find('[data-slot="errors"]');
    $.each(FIELDS, function (key) { clearError(key); });
    var $list = $summary.find('ul').empty();

    $.each(errors, function (_, err) {
      var selector = FIELDS[err.key];
      $list.append($('<li></li>').attr('data-key', err.key).append($('<a></a>').attr('href', selector).text(err.text)));
      $view.find('#f-' + err.key + '-error').text(err.text);
      var $field = err.key === 'condition' ? $view.find('[name="condition"]') : $view.find(selector);
      $field.addClass('is-invalid').attr('aria-invalid', 'true');
    });

    $summary.prop('hidden', !errors.length);
    if (errors.length) {
      $summary[0].focus();
      $summary[0].scrollIntoView({ block: 'start' });
    }
  }

  // Each item in the error summary jumps to its field.
  $view.on('click', '.error-summary a', function (e) {
    e.preventDefault();
    var field = $view.find($(this).attr('href'))[0];
    if (!field) return;
    field.focus();
    field.scrollIntoView({ block: 'center' });
  });

  $view.on('submit', 'form', function (e) {
    e.preventDefault();
    var errors = validate(current);
    showErrors(errors);
    if (errors.length) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    current.status = 'done';
    current.finishedAt = Date.now();
    current.signatureImage = current.signature ? pad.toDataURL() : null;
    var id = current.id;
    Store.put(current).then(function () { go(id, true); }).catch(showStorageError);
  });

  // "Save draft" is a link back to the list; the draft is already autosaved.

  /* ---------- Finished report ---------- */

  function showSummary(r) {
    current = r;
    $view.empty().append(template('tpl-summary'));
    $view.find('[data-slot="title"]').text(r.address);

    var $location = r.location
      ? $('<span></span>').append(
          document.createTextNode(r.location.lat + ', ' + r.location.lng + ' (±' + r.location.accuracy + ' m) · '),
          $('<a target="_blank" rel="noopener"></a>').attr('href', mapUrl(r.location)).text('View map')
        )
      : 'Not recorded';

    var rows = [
      ['Inspection type', r.type],
      ['Date and time', formatWhen(r.inspectedAt)],
      ['Inspector', r.inspector],
      ['Location', $location],
      ['Condition', r.condition],
      ['Follow-up', r.followUp ? r.priority : 'None'],
      ['Notes', r.notes || 'None']
    ];
    var $fields = $view.find('[data-slot="fields"]');
    $.each(rows, function (_, row) {
      var $dd = $('<dd></dd>');
      if (typeof row[1] === 'string') $dd.text(row[1]);
      else $dd.append(row[1]);
      $fields.append($('<dt></dt>').text(row[0]), $dd);
    });

    var $photos = $view.find('[data-slot="photos"]');
    if (!r.photos.length) $photos.append($('<p></p>').text('None'));
    $.each(r.photos, function (i, photo) {
      $photos.append($('<img>').attr({ src: urlFor(photo.blob), alt: 'Photo ' + (i + 1) + ' of ' + r.address, width: photo.width, height: photo.height }));
    });

    var $signature = $view.find('[data-slot="signature"]');
    if (r.signatureImage) {
      $signature.append($('<img class="signature-image">').attr({ src: r.signatureImage, alt: 'Signature of ' + r.inspector }));
    } else {
      $signature.append($('<p class="typed-signature"></p>').text(r.typedSignature));
    }
    $signature.append($('<p class="small text-body-secondary"></p>').text('Finished ' + formatWhen(localDateTime(new Date(r.finishedAt)))));

    $view.find('[data-action="share"]').prop('hidden', !navigator.share);
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  function exportBlob(r) {
    return Promise.all($.map(r.photos, function (p) {
      return blobToDataUrl(p.blob).then(function (dataUrl) {
        return { name: p.name, width: p.width, height: p.height, bytes: p.bytes, dataUrl: dataUrl };
      });
    })).then(function (photos) {
      var out = $.extend({}, r, { photos: photos });
      delete out.signature; // raw pen strokes; the PNG is in signatureImage
      return new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    });
  }

  function fileName(r) {
    return 'report-' + (r.address || r.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.json';
  }

  $view.on('click', '[data-action="download"]', function () {
    var r = current;
    exportBlob(r).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = fileName(r);
      document.body.appendChild(a);
      a.click();
      a.parentNode.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
  });

  $view.on('click', '[data-action="share"]', function () {
    var r = current;
    var text = r.type + ' inspection at ' + r.address + ': ' + r.condition + (r.followUp ? ', follow-up ' + r.priority.toLowerCase() : '') + '.';
    exportBlob(r).then(function (blob) {
      var file = new File([blob], fileName(r), { type: 'application/json' });
      var data = { title: 'Inspection report', text: text };
      if (navigator.canShare && navigator.canShare({ files: [file] })) data.files = [file];
      return navigator.share(data);
    }).catch(function () { /* the person closed the share sheet */ });
  });

  $view.on('click', '[data-action="print"]', function () { window.print(); });

  $view.on('click', '[data-action="edit"]', function () {
    var r = current;
    r.status = 'draft';
    delete r.finishedAt;
    Store.put(r).then(function () { go(r.id, true); });
  });

  /* ---------- Delete ---------- */

  var deleteModal = new bootstrap.Modal(document.getElementById('delete-modal'));
  var deleting = null;

  $view.on('click', '[data-action="delete"]', function () {
    deleting = current.id;
    deleteModal.show();
  });

  $('#delete-confirm').on('click', function () {
    var id = deleting;
    clearTimeout(saveTimer);
    saveTimer = null;
    current = null;
    Store.remove(id).then(function () {
      deleteModal.hide();
      go(null, true);
    });
  });

  /* ---------- Connection status and offline support ---------- */

  function updateNetwork() {
    $('#net-status').prop('hidden', navigator.onLine !== false);
  }
  $(window).on('online offline', updateNetwork);
  updateNetwork();

  var secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if ('serviceWorker' in navigator && secure) {
    $(window).on('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* the app still works online */ });
    });
  }

  route();
})(jQuery, window.ReportStore, window.Photos, window.SignaturePad);
