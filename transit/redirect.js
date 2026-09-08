(function () {
  "use strict";
  var dest = location.pathname.replace(/^\/transit(?=\/|$)/, "/rive");
  if (dest === "/rive") dest = "/rive/";
  location.replace(dest + location.search + location.hash);
})();
