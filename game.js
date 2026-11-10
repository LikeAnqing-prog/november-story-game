'use strict';
const el = id => document.getElementById(id);
const key = 'tomorrow.opening.';
const original = window.STORY;
const storage = {
  get(name) { try { return JSON.parse(localStorage.getItem(key + name)); } catch { return null; } },
  set(name, value) { try { localStorage.setItem(key + name, JSON.stringify(value)); return true; } catch { return false; } }
};
const normalize = data => {
  if (!data || ![1, original.version].includes(data.version) || !data.ui || !data.nodes) return null;
  const openingOnly = data.version === 1;
  const copy = structuredClone(original);
  for (const [id, value] of Object.entries(original.ui)) {
    if (openingOnly && (data.ui[id] === undefined || ['part', 'endHint'].includes(id))) continue;
    if (typeof data.ui[id] !== 'string' || (value && !data.ui[id].trim())) return null;
    copy.ui[id] = data.ui[id];
  }
  for (const [id, node] of Object.entries(copy.nodes)) {
    const edited = data.nodes[id];
    if (openingOnly && (!edited || id === 'end')) continue;
    if (!edited || typeof edited.text !== 'string' || !edited.text.trim()) return null;
    node.text = edited.text;
    if (node.conditional) for (const flag of Object.keys(node.conditional)) {
      if (typeof edited.conditional?.[flag] !== 'string' || !edited.conditional[flag].trim()) return null;
      node.conditional[flag] = edited.conditional[flag];
    }
    if (node.choices) for (const [i, choice] of node.choices.entries()) {
      if (typeof edited.choices?.[i]?.text !== 'string' || !edited.choices[i].text.trim()) return null;
      choice.text = edited.choices[i].text;
    }
  }
  return copy;
};
let story = normalize(storage.get('copy')) || original;
const t = id => story.ui[id] ?? id;
const renderLabels = () => document.querySelectorAll('[data-t]').forEach(node => node.textContent = t(node.dataset.t));
const durations = {slow: 70, normal: 38, fast: 15, instant: 0};
const prefs = storage.get('preferences') || {};
if (!Object.hasOwn(durations, prefs.speed)) prefs.speed = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'normal';
prefs.size = [20,23,27].includes(prefs.size) ? prefs.size : 23;
let state = null;
let fullText = '';
let typing = false;
let typeTimer;
let toastTimer;
let sceneFade;
const panel = el('panel');
const content = el('panel-content');
function nextDestination(node, progress) {
  if (node.nextByBranch) return node.nextByBranch[progress.branch];
  if (node.nextByVisit && progress.history.includes(node.nextByVisit.visited)) {
    return node.nextByVisit.to;
  }
  return node.next;
}

function validateSave(value) {
  if (!value || ![1, 2].includes(value.version) || !Array.isArray(value.history)) return null;
  const {history} = value;
  const first = history[0];
  if (![story.start, story.checkpoint].includes(first) || history.at(-1) !== value.id) return null;
  if (history.length > Object.keys(story.nodes).length) return null;
  if (value.version === 1 && (first !== story.start || history.some(id => story.nodes[id]?.chapter !== 1))) return null;
  const progress = {version: 2, id: first, flag: null, branch: null, history: [first]};
  for (const id of history.slice(1)) {
    if (!Object.hasOwn(story.nodes, id)) return null;
    const from = story.nodes[progress.id];
    const choice = from.choices?.find(option => option.to === id);
    if (!choice && nextDestination(from, progress) !== id) return null;
    if (choice?.flag) progress.flag = choice.flag;
    progress.id = id;
    progress.branch = story.nodes[id].branch || progress.branch;
    progress.history.push(id);
  }
  if (value.flag !== progress.flag) return null;
  return progress;
}
const getSave = () => validateSave(storage.get('save'));
const current = () => story.nodes[state.id];
const lineText = node => node.conditional?.[state.flag] || node.text;
const showToast = id => {
  el('toast').textContent = t(id);
  el('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el('toast').classList.remove('visible'), 2200);
};
function createButton(label, action) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', action);
  return b;
}
function updatePrefs() {
  document.documentElement.style.setProperty('--text-size', `${prefs.size}px`);
  storage.set('preferences', prefs);
}
function finishLine() {
  clearTimeout(typeTimer);
  typing = false;
  el('text').textContent = fullText;
  el('accessible-text').textContent = fullText;
  const node = current();
  const options = el('choices');
  options.replaceChildren();
  options.hidden = !node.choices && !node.ending;
  el('next').hidden = Boolean(node.choices || node.ending);
  el('hint').textContent = t(node.ending ? 'endHint' : node.choices ? 'choiceHint' : 'next');
  for (const choice of node.choices || []) {
    options.append(createButton(choice.text, () => {
      if (choice.flag) state.flag = choice.flag;
      go(choice.to);
    }));
  }
  if (node.ending) options.append(createButton(t('back'), titleScreen));
  if (state.id === 'end' && state.flag) {
    el('hint').textContent = t(state.flag === 'river' ? 'riverNote' : 'ringNote');
  }
}
function renderActor(id, asset, paired) {
  const actor = el(id);
  actor.classList.toggle('child', asset === 'child');
  actor.classList.toggle('paired', paired);
  actor.hidden = !asset;
  if (asset && actor.getAttribute('src') !== `assets/${asset}.png`) actor.src = `assets/${asset}.png`;
}
function draw(immediate = false) {
  clearTimeout(typeTimer);
  const node = current();
  el('title-screen').hidden = true;
  el('reading').hidden = false;
  el('save').disabled = false;
  el('chapter').textContent = story.chapters[node.chapter - 1];
  const scene = el('scene');
  const location = el('location');
  const label = story.locations[node.place || node.bg];
  const hasChanged = !scene.classList.contains(node.bg) || location.textContent !== label;
  scene.className = `scene ${node.bg}`;
  location.hidden = false;
  location.textContent = label;
  if (hasChanged) {
    sceneFade?.cancel();
    if (!immediate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      sceneFade = el('scene-fade').animate([{opacity:.82}, {opacity:0}], {
        duration: 450, easing:'ease-out'
      });
    }
  }
  el('game').dataset.effect = node.effect || '';
  renderActor('actor', node.actor, Boolean(node.companion));
  renderActor('companion', node.companion, Boolean(node.actor));
  el('speaker').textContent = node.speaker === 'narrator' ? '' : t(node.speaker);
  el('evidence').hidden = !node.evidence;
  if (node.evidence) {
    const picture = el('evidence').querySelector('img');
    const asset = `assets/${node.evidence}.png`;
    if (picture.getAttribute('src') !== asset) picture.src = asset;
    el('evidence-name').textContent = story.props[node.evidence][0];
  }
  el('choices').hidden = true;
  el('choices').replaceChildren();
  el('next').hidden = false;
  el('hint').textContent = t('hint');
  el('text').textContent = '';
  el('accessible-text').textContent = '';
  fullText = lineText(node);
  const delay = durations[prefs.speed];
  if (immediate || !delay) { finishLine(); return; }
  const letters = [...fullText];
  let i = 0;
  typing = true;
  const tick = () => {
    const letter = letters[i++];
    el('text').textContent += letter;
    if (i >= letters.length) finishLine();
    else typeTimer = setTimeout(tick, /[。？！…]/.test(letter) ? delay * 3 : delay);
  };
  typeTimer = setTimeout(tick, delay);
}
function go(id) {
  state.id = id;
  state.branch = story.nodes[id].branch || state.branch;
  state.history.push(id);
  draw();
}
function begin(id = story.start) {
  state = {version: 2, id, flag: null, branch: null, history: [id]};
  draw();
}
function advance() {
  if (!state || panel.open) return;
  if (typing) { finishLine(); return; }
  const destination = nextDestination(current(), state);
  if (destination) go(destination);
}
function titleScreen() {
  clearTimeout(typeTimer);
  state = null;
  typing = false;
  el('actor').hidden = true;
  el('companion').hidden = true;
  el('chapter').textContent = story.chapters[0];
  el('location').hidden = true;
  sceneFade?.cancel();
  el('game').dataset.effect = '';
  el('reading').hidden = true;
  el('title-screen').hidden = false;
  el('save').disabled = true;
  el('resume').hidden = !getSave();
  el('scene').className = 'scene home';
}
function save() {
  if (state) showToast(storage.set('save', state) ? 'saved' : 'storageFail');
}
function load() {
  const saved = getSave();
  if (!saved) { showToast('noSave'); return; }
  state = saved;
  draw(true);
  showToast('loaded');
}
function openPanel(title) {
  const h = document.createElement('h2');
  h.textContent = t(title);
  content.replaceChildren(h);
  if (!panel.open) panel.showModal();
}
function showHistory() {
  openPanel('history');
  const history = state?.history || [];
  if (!history.length) content.append(t('emptyHistory'));
  for (const id of history) {
    const node = story.nodes[id];
    const item = document.createElement('div');
    item.className = 'history-line';
    const speaker = document.createElement('small');
    speaker.textContent = node.speaker === 'narrator' ? '' : t(node.speaker);
    const p = document.createElement('p');
    p.textContent = lineText(node);
    item.append(speaker,p);
    content.append(item);
  }
  content.lastElementChild?.scrollIntoView({block:'nearest'});
}
function download(value, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type:'application/json'}));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
function chooseFile(accept) {
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.json,application/json';
  file.onchange = async () => {
    if (!file.files[0]) return;
    try { if (!accept(JSON.parse(await file.files[0].text()))) showToast('invalid'); }
    catch { showToast('invalid'); }
  };
  file.click();
}
function showSettings() {
  openPanel('settings');
  for (const [label, prop, values] of [['speed','speed',Object.keys(durations)],['fontSize','size',[20,23,27]]]) {
    const wrap = document.createElement('label');
    const select = document.createElement('select');
    wrap.append(t(label));
    for (const value of values) select.add(new Option(typeof value === 'number' ? value : t(value), value));
    select.value = prefs[prop];
    select.onchange = () => {
      prefs[prop] = prop === 'size' ? Number(select.value) : select.value;
      updatePrefs();
      if (state && typing) draw();
    };
    wrap.append(select);
    content.append(wrap);
  }
  content.append(createButton(t('edit'), showEditor),createButton(t('restart'), () => {
    if (confirm(t('confirmRestart'))) { panel.close(); begin(); }
  }),createButton(t('exportSave'), () => {
    const exported = state || getSave();
    if (exported) download(exported,'tomorrow-opening-save.json');
    else showToast('noSave');
  }),createButton(t('importSave'), () => chooseFile(value => {
    const imported = validateSave(value);
    if (!imported) return false;
    storage.set('save', imported);
    state = imported;
    panel.close();
    draw(true);
    showToast('loaded');
    return true;
  })));
}
function applyCopy(draft) {
  story = draft;
  const persisted = storage.set('copy', story);
  renderLabels();
  document.title = t('title');
  if (state) draw(true);
  showToast(persisted ? 'edited' : 'storageFail');
}
function showEditor() {
  openPanel('editorTitle');
  const draft = structuredClone(story);
  const search = document.createElement('input');
  search.placeholder = t('search');
  search.setAttribute('aria-label', t('search'));
  const list = document.createElement('div');
  list.className = 'editor-list';
  const addField = (id, object, prop) => {
    if (!`${id} ${object[prop]}`.includes(search.value)) return;
    const wrap = document.createElement('label');
    wrap.textContent = id;
    const field = document.createElement('textarea');
    field.value = object[prop];
    field.oninput = () => object[prop] = field.value;
    wrap.append(field);
    list.append(wrap);
  };
  search.oninput = () => {
    list.replaceChildren();
    for (const [id,node] of Object.entries(draft.nodes)) {
      addField(id,node,'text');
      for (const flag of Object.keys(node.conditional || {})) addField(`${id} · ${flag}`,node.conditional,flag);
      for (const [i,choice] of (node.choices || []).entries()) addField(`${id} · ${i + 1}`,choice,'text');
    }
    for (const id of Object.keys(draft.ui)) addField(id,draft.ui,id);
  };
  content.append(search,list,createButton(t('apply'),() => {
    const updated = normalize(draft);
    if (updated) { panel.close(); applyCopy(updated); } else showToast('invalid');
  }),createButton(t('export'),() => download(draft,'story.zh-CN.json')),createButton(t('import'),() => chooseFile(value => {
    const updated = normalize(value);
    if (!updated) return false;
    panel.close();
    applyCopy(updated);
    return true;
  })),createButton(t('reset'),() => {
    if (confirm(t('confirmReset'))) { panel.close(); applyCopy(original); }
  }));
  search.oninput();
}
el('start').onclick = () => begin();
el('checkpoint').onclick = () => {
  if (confirm(t('checkpointPrompt'))) begin(story.checkpoint);
};
el('resume').onclick = el('load').onclick = load;
el('save').onclick = save;
el('history').onclick = showHistory;
el('settings').onclick = showSettings;
el('dialogue').onclick = advance;
function appendEvidence(id, destination = content) {
  const [name, description] = story.props[id];
  const figure = document.createElement('figure');
  figure.className = 'evidence-detail';
  const img = document.createElement('img');
  img.src = `assets/${id}.png`;
  img.alt = name;
  img.className = 'photo-view';
  const caption = document.createElement('figcaption');
  const label = document.createElement('strong');
  const paragraph = document.createElement('p');
  label.textContent = name;
  paragraph.textContent = description;
  caption.append(label, paragraph);
  figure.append(img, caption);
  destination.append(figure);
}
el('evidence').onclick = () => {
  const evidence = current().evidence;
  if (evidence !== 'funeral-photo') {
    openPanel('evidenceList');
    appendEvidence(evidence);
    return;
  }
  openPanel('comparePhotos');
  const comparison = document.createElement('div');
  comparison.className = 'photo-comparison';
  appendEvidence('funeral-photo-first', comparison);
  appendEvidence('funeral-photo', comparison);
  content.append(comparison);
};
el('archive').onclick = () => {
  openPanel('archivesTitle');
  if (state && (current().chapter >= 3 || state.history.includes(story.checkpoint))) {
    const snapshot = document.createElement('p');
    snapshot.className = 'route-status';
    snapshot.textContent = story.routeStatus[state.branch?.[0] || 'entry'];
    content.append(snapshot);
  }
  const seen = new Set(state?.history[0] === story.checkpoint ? story.checkpointEvidence : []);
  for (const id of state?.history || []) {
    if (story.nodes[id].evidence) seen.add(story.nodes[id].evidence);
  }
  if (!seen.size) content.append(t('emptyArchive'));
  for (const id of seen) appendEvidence(id);
};
el('game').addEventListener('click', event => {
  if (event.target === el('game')) advance();
});
document.addEventListener('keydown', event => {
  if (event.repeat || panel.open || event.target.closest('button,input,select,textarea')) return;
  if (state && [' ','Enter'].includes(event.key)) { event.preventDefault(); advance(); }
});
renderLabels();
document.title = t('title');
updatePrefs();
titleScreen();
