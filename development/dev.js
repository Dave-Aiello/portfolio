/*
 * Looping demo videos: WCAG 2.2.2 asks for a way to pause anything that
 * moves for more than five seconds, and people who ask for reduced motion
 * shouldn't get autoplay at all.
 */
(function () {
  'use strict';

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var videos = document.querySelectorAll('video[data-loop]');

  Array.prototype.forEach.call(videos, function (video) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'video-toggle';

    function sync() {
      button.textContent = video.paused ? 'Play' : 'Pause';
      button.setAttribute('aria-label', (video.paused ? 'Play ' : 'Pause ') + (video.getAttribute('aria-label') || 'video'));
    }

    button.addEventListener('click', function () {
      if (video.paused) video.play();
      else video.pause();
    });
    video.addEventListener('play', sync);
    video.addEventListener('pause', sync);
    video.parentNode.appendChild(button);

    if (reduce) {
      video.pause();
      video.removeAttribute('autoplay');
    }
    sync();
  });
})();
