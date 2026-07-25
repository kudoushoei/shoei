const App = (() => {
  let current = "dashboard";
  const root = document.getElementById("view-root");
  const headerTitle = document.getElementById("header-title");
  const tabBar = document.getElementById("tab-bar");

  async function showView(name) {
    current = name;
    tabBar.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    headerTitle.textContent = Views[name].title;
    root.innerHTML = "";
    await Views[name].render(root);
    root.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  let toastTimer = null;
  function toast(message) {
    const el = document.getElementById("toast");
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 1800);
  }

  function init() {
    tabBar.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => showView(btn.dataset.view));
    });
    showView("dashboard");

    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    }
  }

  return { showView, toast, init };
})();

document.addEventListener("DOMContentLoaded", App.init);
