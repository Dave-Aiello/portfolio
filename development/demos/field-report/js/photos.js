/*
 * Shrinks camera photos before saving them: phone photos are often 3-6 MB,
 * which fills device storage and is slow to send on a weak signal.
 * Draws each image onto a canvas at most 1600px on its long edge and
 * re-encodes it as JPEG.
 */
(function (root) {
  'use strict';

  var MAX_EDGE = 1600;
  var QUALITY = 0.8;

  function decode(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error(file.name + ' could not be read as an image.'));
      };
      img.src = url;
    });
  }

  function toBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('This browser could not compress the photo.'));
      }, 'image/jpeg', QUALITY);
    });
  }

  function shrink(file) {
    return decode(file).then(function (decoded) {
      var img = decoded.img;
      var scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; // transparent PNGs become white, not black
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(decoded.url);

      return toBlob(canvas).then(function (blob) {
        // A small JPEG can come out bigger after re-encoding; keep the original then.
        var keepOriginal = scale === 1 && file.type === 'image/jpeg' && blob.size >= file.size;
        return {
          id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          name: file.name,
          blob: keepOriginal ? file : blob,
          width: canvas.width,
          height: canvas.height,
          originalBytes: file.size,
          bytes: keepOriginal ? file.size : blob.size
        };
      });
    });
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  root.Photos = { shrink: shrink, formatBytes: formatBytes, MAX_EDGE: MAX_EDGE };
})(window);
