(() => {
  'use strict';
  const mobile = window.matchMedia('(max-width: 1000px)');
  const menu = document.querySelector('[data-admin-menu]');
  const navigation = document.getElementById('admin-navigation');
  if (menu && navigation) {
    const syncMenu = () => {
      navigation.hidden = mobile.matches;
      menu.setAttribute('aria-expanded', String(!navigation.hidden));
    };
    menu.addEventListener('click', () => {
      navigation.hidden = !navigation.hidden;
      menu.setAttribute('aria-expanded', String(!navigation.hidden));
    });
    mobile.addEventListener('change', syncMenu);
    syncMenu();
  }

  document.querySelectorAll('.admin-toolbar').forEach((toolbar, index) => {
    const fields = [...toolbar.querySelectorAll(':scope > label:not(.admin-search)')];
    if (!fields.length) return;
    const filters = document.createElement('div');
    filters.className = 'admin-filter-fields';
    filters.id = `admin-filters-${index}`;
    fields[0].before(filters);
    fields.forEach((field) => filters.append(field));
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'button button-secondary admin-filter-toggle';
    toggle.setAttribute('aria-controls', filters.id);
    const selected = fields.filter((field) => field.querySelector('select')?.value !== 'all').length;
    toggle.textContent = selected ? `筛选 · ${selected} 项` : '筛选';
    filters.before(toggle);
    const syncFilters = () => {
      filters.hidden = mobile.matches && !selected;
      toggle.setAttribute('aria-expanded', String(!filters.hidden));
    };
    toggle.addEventListener('click', () => {
      filters.hidden = !filters.hidden;
      toggle.setAttribute('aria-expanded', String(!filters.hidden));
    });
    mobile.addEventListener('change', syncFilters);
    syncFilters();
  });

  const settings = document.querySelector('[data-admin-settings]');
  if (settings) {
    const original = new URLSearchParams(new FormData(settings)).toString();
    const state = settings.querySelector('[data-settings-state]');
    settings.querySelectorAll('[maxlength]').forEach((input) => {
      const counter = document.createElement('span');
      counter.className = 'admin-field-count';
      counter.id = `${input.id}-count`;
      input.setAttribute('aria-describedby', `${input.getAttribute('aria-describedby') || ''} ${counter.id}`.trim());
      input.after(counter);
      const count = () => { counter.textContent = `${input.value.length} / ${input.maxLength}`; };
      input.addEventListener('input', count);
      count();
    });
    const update = () => {
      settings.querySelectorAll('[name]').forEach((input) => {
        const preview = document.querySelector(`[data-preview-field="${input.name}"]`);
        if (preview) preview.textContent = input.value || '尚未填写';
      });
      if (state) state.textContent = new URLSearchParams(new FormData(settings)).toString() === original
        ? '下一步确认更改' : '有未保存的更改';
    };
    settings.addEventListener('input', update);
    settings.addEventListener('change', update);
  }

  document.querySelectorAll('.admin-main form[method="post"]').forEach((form) => {
    form.addEventListener('submit', () => {
      const button = form.querySelector('button[type="submit"]');
      if (!button || !form.checkValidity()) return;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = '正在处理…';
    });
  });
  window.addEventListener('pageshow', () => {
    document.querySelectorAll('.admin-main button[aria-busy="true"]').forEach((button) => {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = button.dataset.originalLabel || '继续';
    });
  });
  document.querySelectorAll('.admin-main button[type="submit"]').forEach((button) => {
    button.dataset.originalLabel = button.textContent;
  });
})();
