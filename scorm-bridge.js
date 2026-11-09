(function () {
  var cfg = window.DISPATCH_CONFIG;
  var iframe = document.getElementById("curso");

  // Datos que el curso puede escribir en Moodle
  var WRITABLE = [
    "cmi.core.lesson_status",
    "cmi.core.lesson_location",
    "cmi.core.score.raw",
    "cmi.core.score.min",
    "cmi.core.score.max"
  ];

  var READABLE = WRITABLE.concat(["cmi.student_data.mastery_score"]);

  // buscar la API REAL de Moodle
  function findAPI(win) {
    var tries = 0;
    while (!win.API && win.parent && win.parent !== win && tries < 20) {
      win = win.parent;
      tries++;
    }
    return win.API || null;
  }

  var api = findAPI(window);
  if (!api && window.opener) api = findAPI(window.opener);

  if (!api) {
    document.body.innerHTML = "<p style='font-family:sans-serif;padding:20px'>" +
      "No se encontró la API SCORM del LMS.</p>";
    return;
  }

  // Envoltura que registra en consola cada llamada a la API real de Moodle
  var realApi = api;   // <-- LÍNEA QUE FALTABA: guarda la API real de Moodle
  api = {};
  ["LMSInitialize", "LMSGetValue", "LMSSetValue", "LMSCommit", "LMSFinish"].forEach(function (fn) {
    api[fn] = function () {
      var args = Array.prototype.slice.call(arguments);
      var result = realApi[fn].apply(realApi, args);
      console.log("[Dispatch → Moodle]", fn, args, "=>", result);
      return result;
    };
  });

  // abrir sesión con Moodle y leer lo que ya tenía guardado
  api.LMSInitialize("");
  var initial = {};
  READABLE.forEach(function (k) { initial[k] = api.LMSGetValue(k); });

  var status = initial["cmi.core.lesson_status"];
  if (!status || status === "not attempted") {
    api.LMSSetValue("cmi.core.lesson_status", "incomplete");
    api.LMSCommit("");
    initial["cmi.core.lesson_status"] = "incomplete";
  }

  var finished = false;

  // escuchar los mensajes del curso
  window.addEventListener("message", function (e) {
    // valida si viene del dominio autorizado
    if (e.origin !== cfg.allowedOrigin) return;
    // valida si viene de nuestro iframe y no de otra ventana
    if (e.source !== iframe.contentWindow) return;
    // valida si tiene el formato esperado
    var m = e.data;
    if (!m || typeof m !== "object") return;

    if (m.type === "ready") {
      iframe.contentWindow.postMessage(
        { type: "init", values: initial }, cfg.allowedOrigin
      );
      return;
    }

    if (m.type !== "scorm" || finished) return;

    if (m.action === "setValue") {
      // valida el permiso de ciertos datos
      if (WRITABLE.indexOf(m.key) === -1) return;
      api.LMSSetValue(m.key, String(m.value));
      api.LMSCommit("");
    } else if (m.action === "commit") {
      api.LMSCommit("");
    } else if (m.action === "finish") {
      closeSession();
    }
  });

  // carga del curso remoto
  iframe.src = cfg.courseUrl;

  // cierra la sesión (una sola vez)
  function closeSession() {
    if (finished) return;
    finished = true;
    api.LMSCommit("");
    api.LMSFinish("");
  }
  window.addEventListener("beforeunload", closeSession);
})();