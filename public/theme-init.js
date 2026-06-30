// Apply the saved colour theme before first paint so a light-mode reload doesn't
// flash the default (dark) theme. Loaded as a blocking <script> in <head>, ahead
// of the deferred app bundle which runs too late. Mirrors THEME_KEY in main.ts.
try {
  var theme = localStorage.getItem("cv.theme") === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", theme);
} catch (e) {
  /* localStorage unavailable (e.g. blocked cookies) — fall back to the CSS default. */
}
