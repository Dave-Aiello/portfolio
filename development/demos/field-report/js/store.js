/*
 * IndexedDB storage for reports, wrapped in promises.
 * Photos are stored as Blobs inside each report, so nothing leaves the device.
 */
(function (root) {
  'use strict';

  var DB_NAME = 'field-reports';
  var VERSION = 1;
  var STORE = 'reports';
  var opening = null;

  function open() {
    if (opening) return opening;
    opening = new Promise(function (resolve, reject) {
      if (!root.indexedDB) {
        reject(new Error('This browser cannot save reports.'));
        return;
      }
      var request = root.indexedDB.open(DB_NAME, VERSION);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
    return opening;
  }

  /* Runs one request in a transaction and resolves once the transaction commits. */
  function run(mode, makeRequest) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var request = makeRequest(tx.objectStore(STORE));
        var result;
        request.onsuccess = function () { result = request.result; };
        tx.oncomplete = function () { resolve(result); };
        tx.onerror = tx.onabort = function () { reject(tx.error || request.error); };
      });
    });
  }

  root.ReportStore = {
    all: function () {
      return run('readonly', function (store) { return store.getAll(); }).then(function (reports) {
        return reports.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
      });
    },
    get: function (id) {
      return run('readonly', function (store) { return store.get(id); });
    },
    put: function (report) {
      report.updatedAt = Date.now();
      return run('readwrite', function (store) { return store.put(report); });
    },
    remove: function (id) {
      return run('readwrite', function (store) { return store['delete'](id); });
    }
  };
})(window);
