// Mobile menu
const toggle = document.querySelector('.menu-toggle');
const menu = document.querySelector('.menu');
if (toggle && menu) {
  toggle.addEventListener('click', () => {
    const open = menu.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    menu.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }));
}

// Theme toggle (light / dark), defaults to the OS preference
const themeToggle = document.querySelector('.theme-toggle');
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const root = document.documentElement;
    const current = root.getAttribute('data-theme') ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) {}
  });
}

// Language menu (EN / ES / PT / IT)
const langToggle = document.querySelector('.lang-toggle');
const langMenu = document.getElementById('lang-menu');
if (langToggle && langMenu && window.AgenstrumI18n) {
  const items = [...langMenu.querySelectorAll('[data-lang]')];

  const sync = lang => {
    langToggle.querySelector('.lang-code').textContent = lang.toUpperCase();
    items.forEach(b => b.setAttribute('aria-checked', String(b.dataset.lang === lang)));
    const field = document.getElementById('form-lang');
    if (field) field.value = lang;
  };

  const close = (focusToggle) => {
    langMenu.hidden = true;
    langToggle.setAttribute('aria-expanded', 'false');
    if (focusToggle) langToggle.focus();
  };

  const open = () => {
    langMenu.hidden = false;
    langToggle.setAttribute('aria-expanded', 'true');
    (items.find(b => b.getAttribute('aria-checked') === 'true') || items[0]).focus();
  };

  langToggle.addEventListener('click', () => langMenu.hidden ? open() : close(false));
  items.forEach(b => b.addEventListener('click', () => {
    AgenstrumI18n.set(b.dataset.lang);
    close(true);
  }));
  langMenu.addEventListener('keydown', e => {
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (e.key === 'Tab') close(false);
  });
  document.addEventListener('click', e => {
    if (!langMenu.hidden && !e.target.closest('.lang')) close(false);
  });

  document.addEventListener('langchange', e => sync(e.detail.lang));
  sync(AgenstrumI18n.current);
}

// Current year
document.getElementById('year').textContent = new Date().getFullYear();

// Confirmation after FormSubmit redirects back with ?sent
if (new URLSearchParams(location.search).has('sent')) {
  const status = document.getElementById('form-status');
  if (status) status.hidden = false;
}

// Reveal on scroll
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('reveal');
      observer.unobserve(entry.target);
    }
  })
}, { threshold: 0.14 });

document.querySelectorAll('.card, .pillar, .tech-card, .rpi .step, .about .badge').forEach(el => {
  el.classList.add('will-reveal');
  observer.observe(el);
});

// Service cards: open the whole card full screen (overlay fallback where the
// Fullscreen API isn't available, e.g. iPhone Safari)
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
const setExpandState = (card, on) => {
  const btn = card.querySelector('.card-expand');
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(on));
  const lang = (window.AgenstrumI18n && AgenstrumI18n.current) || 'en';
  const L = {
    en: ['Open full screen', 'Exit full screen'], es: ['Abrir en pantalla completa', 'Salir de pantalla completa'],
    pt: ['Abrir em tela cheia', 'Sair da tela cheia'], it: ['Apri a schermo intero', 'Esci dallo schermo intero']
  }[lang] || ['Open full screen', 'Exit full screen'];
  btn.setAttribute('aria-label', on ? L[1] : L[0]);
};
document.querySelectorAll('.card.service').forEach(card => {
  const btn = card.querySelector('.card-expand');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const native = card.requestFullscreen || card.webkitRequestFullscreen;
    if (fsElement() === card) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else if (card.classList.contains('is-expanded')) {
      card.classList.remove('is-expanded');
      document.body.classList.remove('has-expanded');
      setExpandState(card, false);
    } else if (native && document.fullscreenEnabled !== false) {
      Promise.resolve(native.call(card)).catch(() => {
        card.classList.add('is-expanded'); document.body.classList.add('has-expanded'); setExpandState(card, true);
      });
    } else {
      card.classList.add('is-expanded');
      document.body.classList.add('has-expanded');
      setExpandState(card, true);
    }
  });
});
['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, () => {
  document.querySelectorAll('.card.service').forEach(c => setExpandState(c, fsElement() === c));
}));
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.card.service.is-expanded').forEach(c => {
    c.classList.remove('is-expanded'); setExpandState(c, false);
  });
  document.body.classList.remove('has-expanded');
});
