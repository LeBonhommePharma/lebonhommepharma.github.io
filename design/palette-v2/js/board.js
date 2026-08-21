/* The prototype exposed three booleans as <x-dc> props — showGrid,
   showApplied, showTokenSpecs — each defaulting to true and each
   gating an <sc-if> block. Here they are toolbar switches that add a
   class to <html>; board.css does the hiding.

   The markup renders in the props-on state with no script, so the
   board is still correct if this file never loads. */

(function () {
  'use strict';

  var SWITCHES = [
    { input: 't-grid', off: 'no-grid' },
    { input: 't-applied', off: 'no-applied' },
    { input: 't-spec', off: 'no-spec' },
  ];

  var root = document.documentElement;

  SWITCHES.forEach(function (sw) {
    var el = document.getElementById(sw.input);
    if (!el) return;

    var apply = function () {
      root.classList.toggle(sw.off, !el.checked);
    };

    el.addEventListener('change', apply);
    apply();
  });
})();
