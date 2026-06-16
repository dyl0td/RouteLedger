const storeKey = "routeledger.v3";
const legacyStoreKeys = ["routeledger.v2", "routeledger.v1"];
const defaultState = {
  settings: {
    businessName: "RouteLedger",
    defaultCenter: "San Diego, CA"
  },
  entries: [],
  searchHistory: []
};

let state = loadState();
let map;
let selectedId = null;
let markers = new Map();
let lastPosition = null;
let lastSearchAt = 0;
let draftPin = null;
let searchPin = null;
let searchRequestId = 0;
let lastSearchValue = "";
let searchDropdownOpen = false;

const $ = (id) => document.getElementById(id);

const els = {
  welcome: $("welcome"),
  mapScreen: $("mapScreen"),
  openMaps: $("openMaps"),
  backHome: $("backHome"),
  toolsButton: $("toolsButton"),
  toolsDrawer: $("toolsDrawer"),
  closeTools: $("closeTools"),
  startPinButton: $("startPinButton"),
  loadHousesButton: $("loadHousesButton"),
  fallbackSettings: $("fallbackSettings"),
  mapFallback: $("mapFallback"),
  entryLabel: $("entryLabel"),
  entryName: $("entryName"),
  entryNotes: $("entryNotes"),
  routeStats: $("routeStats"),
  dropProgress: $("dropProgress"),
  progressFill: $("progressFill"),
  entryList: $("entryList"),
  locateButton: $("locateButton"),
  clearCompleted: $("clearCompleted"),
  clearAll: $("clearAll"),
  searchInput: $("searchInput"),
  searchButton: $("searchButton"),
  searchHistoryPanel: $("searchHistoryPanel"),
  searchHistoryList: $("searchHistoryList"),
  pinConfirmBar: $("pinConfirmBar"),
  confirmPin: $("confirmPin"),
  cancelPin: $("cancelPin"),
  settingsButton: $("settingsButton"),
  settingsDialog: $("settingsDialog"),
  businessName: $("businessName"),
  defaultCenter: $("defaultCenter"),
  saveSettings: $("saveSettings"),
  exportData: $("exportData"),
  importData: $("importData"),
  appTitle: $("appTitle"),
  welcomeTitle: $("welcomeTitle"),
  itemDialog: $("itemDialog"),
  itemDialogTitle: $("itemDialogTitle"),
  itemName: $("itemName"),
  itemNotes: $("itemNotes"),
  itemComplete: $("itemComplete"),
  saveItem: $("saveItem"),
  deleteItem: $("deleteItem")
};

document.addEventListener("DOMContentLoaded", () => {
  applySettingsToUi();
  bindEvents();
  watchSearchField();
});

function bindEvents() {
  els.openMaps.addEventListener("click", () => {
    els.welcome.classList.add("hidden");
    els.mapScreen.classList.remove("hidden");
    window.scrollTo(0, 0);
    bootMap();
    render();
  });

  els.backHome.addEventListener("click", () => {
    cancelDraftPin();
    closeTools();
    els.mapScreen.classList.add("hidden");
    els.welcome.classList.remove("hidden");
  });

  els.toolsButton.addEventListener("click", toggleTools);
  els.closeTools.addEventListener("click", closeTools);
  els.fallbackSettings.addEventListener("click", openSettings);
  els.settingsButton.addEventListener("click", openSettings);
  els.startPinButton.addEventListener("click", startPinPlacement);
  els.loadHousesButton.addEventListener("click", loadHouseCheckboxes);
  els.confirmPin.addEventListener("click", confirmDraftPin);
  els.pinConfirmBar.addEventListener("click", (event) => {
    if (event.target.closest("#confirmPin")) confirmDraftPin();
    if (event.target.closest("#cancelPin")) cancelDraftPin();
  });
  els.cancelPin.addEventListener("click", cancelDraftPin);
  els.saveSettings.addEventListener("click", saveSettings);
  els.exportData.addEventListener("click", exportData);
  els.importData.addEventListener("change", importData);
  els.locateButton.addEventListener("click", locateUser);
  els.clearCompleted.addEventListener("click", clearCompletedDrops);
  els.clearAll.addEventListener("click", clearAllSaved);

  els.searchButton.addEventListener("click", searchAddress);
  els.searchInput.addEventListener("input", handleSearchInput);
  els.searchInput.addEventListener("search", handleSearchInput);
  els.searchInput.addEventListener("change", handleSearchInput);
  els.searchInput.addEventListener("focus", openSearchDropdown);
  els.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchAddress();
    if (event.key === "Escape") closeSearchDropdown();
  });
  els.searchHistoryList.addEventListener("click", handleSearchHistoryClick);
  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".searchbar") || event.target.closest("#searchHistoryPanel")) return;
    closeSearchDropdown();
  });

  els.itemDialog.addEventListener("close", () => {
    selectedId = null;
    renderMarkers();
  });
  els.saveItem.addEventListener("click", saveSelectedItem);
  els.deleteItem.addEventListener("click", deleteSelectedItem);
}

function loadState() {
  try {
    const savedText = localStorage.getItem(storeKey) || legacyStoreKeys.map((key) => localStorage.getItem(key)).find(Boolean);
    return normalizeState(JSON.parse(savedText));
  } catch {
    return structuredClone(defaultState);
  }
}

function normalizeState(saved) {
  if (!saved) return structuredClone(defaultState);
  return {
    ...defaultState,
    ...saved,
    settings: {
      ...defaultState.settings,
      ...(saved.settings || {}),
      apiKey: undefined
    },
    entries: Array.isArray(saved.entries) ? saved.entries.map(normalizeEntry) : [],
    searchHistory: Array.isArray(saved.searchHistory) ? saved.searchHistory.map(normalizeSearchHistoryItem) : []
  };
}

function normalizeSearchHistoryItem(item) {
  if (typeof item === "string") {
    return { id: crypto.randomUUID(), text: item, lastUsed: new Date().toISOString() };
  }
  return {
    id: item.id || crypto.randomUUID(),
    text: String(item.text || "").trim(),
    lastUsed: item.lastUsed || new Date().toISOString()
  };
}

function normalizeEntry(entry) {
  if (entry.type === "drop") {
    return {
      ...entry,
      type: "house",
      name: entry.name || "House",
      completed: Boolean(entry.completed)
    };
  }
  return {
    ...entry,
    type: entry.type || "sign",
    completed: Boolean(entry.completed)
  };
}

function persist() {
  localStorage.setItem(storeKey, JSON.stringify(state));
}

function applySettingsToUi() {
  const name = state.settings.businessName || "RouteLedger";
  els.appTitle.textContent = name;
  els.welcomeTitle.textContent = name;
  els.businessName.value = name;
  els.defaultCenter.value = state.settings.defaultCenter || "";
}

function bootMap() {
  if (map) {
    setTimeout(() => map.invalidateSize(), 80);
    return;
  }

  if (!window.L) {
    els.mapFallback.classList.remove("hidden");
    showToast("Map library did not load. Check your internet connection.");
    return;
  }

  createMap();
}

function createMap() {
  els.mapFallback.classList.add("hidden");
  map = L.map("map", {
    zoomControl: false,
    tap: true
  }).setView([32.7157, -117.1611], 15);

  L.control.zoom({ position: "bottomleft" }).addTo(map);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  map.whenReady(() => {
    setTimeout(() => map.invalidateSize(), 80);
    centerDefault();
    renderMarkers();
  });
}

function toggleTools() {
  els.toolsDrawer.classList.toggle("hidden");
  if (map) setTimeout(() => map.invalidateSize(), 80);
}

function closeTools() {
  els.toolsDrawer.classList.add("hidden");
}

async function centerDefault() {
  if (!state.settings.defaultCenter) return;
  const result = await geocodeAddress(state.settings.defaultCenter, true);
  if (result && map) map.setView([result.lat, result.lng], 15);
}

function startPinPlacement() {
  if (!map) return;
  cancelDraftPin();
  closeTools();
  closeSearchDropdown();
  const center = map.getCenter();
  draftPin = L.marker(center, {
    draggable: true,
    icon: signIcon(true),
    zIndexOffset: 1000
  }).addTo(map);
  els.pinConfirmBar.classList.remove("hidden");
  showToast("Drag the pin, then tap Confirm Pin.");
}

function confirmDraftPin() {
  if (!draftPin) {
    els.pinConfirmBar.classList.add("hidden");
    return;
  }
  const position = draftPin.getLatLng();
  const entry = {
    id: crypto.randomUUID(),
    type: "sign",
    name: els.entryName.value.trim() || "Open house sign",
    notes: els.entryNotes.value.trim(),
    completed: false,
    lat: position.lat,
    lng: position.lng,
    createdAt: new Date().toISOString()
  };
  draftPin.remove();
  draftPin = null;
  els.pinConfirmBar.classList.add("hidden");
  els.entryName.value = "";
  els.entryNotes.value = "";
  state.entries.unshift(entry);
  persist();
  render();
  showToast("Sign pin saved.");
}

function cancelDraftPin() {
  if (draftPin) draftPin.remove();
  draftPin = null;
  els.pinConfirmBar.classList.add("hidden");
}

async function loadHouseCheckboxes() {
  if (!map) return;
  closeTools();
  if (map.getZoom() < 17) {
    showToast("Zoom closer to the houses first.");
    return;
  }

  els.loadHousesButton.disabled = true;
  showToast("Finding houses in this map view...");

  try {
    const houses = await fetchVisibleBuildings();
    let added = 0;
    const existing = new Set(state.entries.map((entry) => entry.osmId).filter(Boolean));

    houses.forEach((house, index) => {
      if (existing.has(house.osmId)) return;
      state.entries.unshift({
        id: crypto.randomUUID(),
        osmId: house.osmId,
        type: "house",
        name: house.name || `House ${index + 1}`,
        notes: "",
        completed: false,
        lat: house.lat,
        lng: house.lng,
        createdAt: new Date().toISOString()
      });
      existing.add(house.osmId);
      added += 1;
    });

    persist();
    render();
    showToast(added ? `${added} house checkboxes added.` : "No new houses found in this view.");
  } catch {
    showToast("House lookup is unavailable right now.");
  } finally {
    els.loadHousesButton.disabled = false;
  }
}

async function fetchVisibleBuildings() {
  const bounds = map.getBounds();
  const south = bounds.getSouth().toFixed(6);
  const west = bounds.getWest().toFixed(6);
  const north = bounds.getNorth().toFixed(6);
  const east = bounds.getEast().toFixed(6);
  const query = `
    [out:json][timeout:12];
    (
      way["building"](${south},${west},${north},${east});
      relation["building"](${south},${west},${north},${east});
    );
    out center 180;
  `;
  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ data: query }).toString()
  });
  if (!response.ok) throw new Error("Overpass request failed");
  const data = await response.json();
  return (data.elements || [])
    .filter((item) => item.center && isLikelyHouse(item.tags || {}))
    .slice(0, 180)
    .map((item) => ({
      osmId: `${item.type}-${item.id}`,
      lat: item.center.lat,
      lng: item.center.lon,
      name: item.tags["addr:housenumber"] && item.tags["addr:street"]
        ? `${item.tags["addr:housenumber"]} ${item.tags["addr:street"]}`
        : "House"
    }));
}

function isLikelyHouse(tags) {
  const building = String(tags.building || "").toLowerCase();
  const allowed = ["yes", "house", "residential", "detached", "semidetached_house", "terrace", "apartments", "bungalow", "duplex"];
  const blocked = ["commercial", "industrial", "retail", "school", "church", "garage", "shed", "warehouse", "roof"];
  return allowed.includes(building) || (!blocked.includes(building) && Boolean(tags["addr:housenumber"]));
}

function render() {
  applySettingsToUi();
  renderStats();
  renderList();
  renderSearchHistory();
  renderMarkers();
}

function renderSearchHistory() {
  const query = els.searchInput.value.trim().toLowerCase();
  const items = state.searchHistory
    .filter((item) => item.text)
    .filter((item) => !query || item.text.toLowerCase().includes(query));
  els.searchHistoryPanel.classList.toggle("hidden", !searchDropdownOpen || !items.length);
  els.searchHistoryList.innerHTML = "";

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "search-history-item";
    row.dataset.id = item.id;
    row.innerHTML = `
      <button class="search-history-text" type="button">${escapeHtml(item.text)}</button>
      <button class="search-history-remove" type="button" aria-label="Remove ${escapeHtml(item.text)}">X</button>
    `;
    els.searchHistoryList.appendChild(row);
  });
}

function renderStats() {
  const signs = state.entries.filter((entry) => entry.type === "sign").length;
  const houses = state.entries.filter((entry) => entry.type === "house");
  const completed = houses.filter((entry) => entry.completed).length;
  els.routeStats.textContent = `${signs} signs / ${completed}/${houses.length} houses`;
  els.dropProgress.textContent = `${completed} / ${houses.length}`;
  els.progressFill.style.width = houses.length ? `${Math.round((completed / houses.length) * 100)}%` : "0%";
}

function renderList() {
  els.entryList.innerHTML = "";

  if (!state.entries.length) {
    const empty = document.createElement("div");
    empty.className = "entry-item";
    empty.innerHTML = `<span class="entry-dot sign">+</span><div class="entry-copy"><strong>No saved items yet</strong><span>Use Map tools to begin</span></div><span></span>`;
    els.entryList.appendChild(empty);
    return;
  }

  state.entries.slice(0, 60).forEach((entry) => {
    const row = document.createElement("div");
    row.className = "entry-item";
    const label = entry.type === "sign" ? "Sign" : entry.completed ? "Dropped" : "Pending";
    row.innerHTML = `
      <span class="entry-dot ${entry.type === "sign" ? "sign" : entry.completed ? "done" : "drop"}">${entry.type === "sign" ? "S" : "H"}</span>
      <div class="entry-copy">
        <strong>${escapeHtml(entry.name)}</strong>
        <span>${label}${entry.notes ? ` / ${escapeHtml(entry.notes)}` : ""}</span>
      </div>
      <button type="button" aria-label="Edit">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5h7M12 12h7M12 19h7M5 5h.01M5 12h.01M5 19h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    `;
    row.querySelector("button").addEventListener("click", () => openItem(entry.id));
    row.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      if (map) map.setView([entry.lat, entry.lng], Math.max(map.getZoom(), 18));
    });
    els.entryList.appendChild(row);
  });
}

function renderMarkers() {
  if (!map || !window.L) return;
  const currentIds = new Set(state.entries.map((entry) => entry.id));
  markers.forEach((marker, id) => {
    if (!currentIds.has(id)) {
      marker.remove();
      markers.delete(id);
    }
  });

  state.entries.forEach((entry) => {
    const position = [entry.lat, entry.lng];
    const existing = markers.get(entry.id);
    if (existing) {
      existing.setLatLng(position);
      existing.setIcon(entry.type === "house" ? houseIcon(entry.completed) : signIcon(false, entry.id === selectedId));
      return;
    }

    const marker = L.marker(position, {
      title: entry.name,
      icon: entry.type === "house" ? houseIcon(entry.completed) : signIcon(false, entry.id === selectedId)
    }).addTo(map);

    marker.on("click", () => {
      if (entry.type === "house") {
        entry.completed = !entry.completed;
        persist();
        render();
      } else {
        selectedId = entry.id;
        renderMarkers();
        openItem(entry.id);
      }
    });

    markers.set(entry.id, marker);
  });
}

function signIcon(isDraft, isSelected = false) {
  return L.divIcon({
    className: "",
    iconSize: isSelected ? [50, 60] : [42, 52],
    iconAnchor: isSelected ? [25, 58] : [21, 50],
    html: `
      <span class="map-marker ${isDraft ? "draft" : ""} ${isSelected ? "selected" : ""}" style="--marker-color:#d69d2f">
        <span>S</span>
      </span>
    `
  });
}

function searchIcon() {
  return L.divIcon({
    className: "",
    iconSize: [36, 46],
    iconAnchor: [18, 44],
    html: `
      <span class="search-result-marker">
        <span></span>
      </span>
    `
  });
}

function houseIcon(completed) {
  return L.divIcon({
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `
      <button class="house-check ${completed ? "complete" : ""}" type="button" aria-label="House checkbox">
        <span></span>
      </button>
    `
  });
}

function locateUser() {
  if (!navigator.geolocation) {
    showToast("Location is not available on this browser.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      lastPosition = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
      };
      if (map) map.setView([lastPosition.lat, lastPosition.lng], 18);
      showToast("Location found.");
    },
    () => showToast("Location permission was not granted."),
    { enableHighAccuracy: true, timeout: 9000, maximumAge: 30000 }
  );
}

async function searchAddress() {
  const address = els.searchInput.value.trim();
  if (!address) {
    clearSearchPin();
    return;
  }
  const result = await geocodeAddress(address);
  if (result && map) {
    map.setView([result.lat, result.lng], 18);
    setSearchPin(result);
    addSearchHistory(address);
  } else {
    showToast("Address not found.");
  }
}

function addSearchHistory(address) {
  const text = address.trim();
  if (!text) return;
  state.searchHistory = state.searchHistory.filter((item) => item.text.toLowerCase() !== text.toLowerCase());
  state.searchHistory.unshift({
    id: crypto.randomUUID(),
    text,
    lastUsed: new Date().toISOString()
  });
  state.searchHistory = state.searchHistory.slice(0, 30);
  persist();
  openSearchDropdown();
}

function openSearchDropdown() {
  searchDropdownOpen = true;
  renderSearchHistory();
}

function closeSearchDropdown() {
  searchDropdownOpen = false;
  renderSearchHistory();
}

function handleSearchHistoryClick(event) {
  const row = event.target.closest(".search-history-item");
  if (!row) return;
  const item = state.searchHistory.find((entry) => entry.id === row.dataset.id);
  if (!item) return;

  if (event.target.closest(".search-history-remove")) {
    state.searchHistory = state.searchHistory.filter((entry) => entry.id !== item.id);
    persist();
    searchDropdownOpen = true;
    renderSearchHistory();
    return;
  }

  els.searchInput.value = item.text;
  searchAddress();
}

function handleSearchInput() {
  const address = els.searchInput.value.trim();
  searchRequestId += 1;
  searchDropdownOpen = true;
  if (!address) clearSearchPin();
  renderSearchHistory();
}

function watchSearchField() {
  lastSearchValue = els.searchInput.value;
  setInterval(() => {
    const currentValue = els.searchInput.value;
    if (lastSearchValue && !currentValue.trim()) clearSearchPin();
    lastSearchValue = currentValue;
  }, 250);
}

function setSearchPin(position) {
  if (!map) return;
  if (searchPin) {
    searchPin.setLatLng([position.lat, position.lng]);
    return;
  }
  searchPin = L.marker([position.lat, position.lng], {
    icon: searchIcon(),
    interactive: false,
    zIndexOffset: 900
  }).addTo(map);
}

function clearSearchPin() {
  if (searchPin) searchPin.remove();
  searchPin = null;
}

async function geocodeAddress(address, quiet = false) {
  const elapsed = Date.now() - lastSearchAt;
  if (elapsed < 1100) await new Promise((resolve) => setTimeout(resolve, 1100 - elapsed));
  lastSearchAt = Date.now();

  try {
    const params = new URLSearchParams({
      format: "jsonv2",
      limit: "1",
      q: address
    });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error("Geocoding failed");
    const results = await response.json();
    if (!results.length) return null;
    return {
      lat: Number(results[0].lat),
      lng: Number(results[0].lon)
    };
  } catch {
    if (!quiet) showToast("Search is temporarily unavailable.");
    return null;
  }
}

function openSettings() {
  applySettingsToUi();
  els.settingsDialog.showModal();
}

function saveSettings() {
  state.settings.businessName = els.businessName.value.trim() || "RouteLedger";
  state.settings.defaultCenter = els.defaultCenter.value.trim() || "San Diego, CA";
  delete state.settings.apiKey;
  persist();
  applySettingsToUi();
  els.settingsDialog.close();
  centerDefault();
  showToast("Settings saved.");
}

function openItem(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  selectedId = id;
  renderMarkers();
  els.itemDialogTitle.textContent = entry.type === "sign" ? "Sign" : "House checkbox";
  els.itemName.value = entry.name;
  els.itemNotes.value = entry.notes || "";
  els.itemComplete.checked = Boolean(entry.completed);
  els.itemComplete.closest("label").style.display = entry.type === "house" ? "flex" : "none";
  els.itemDialog.showModal();
}

function saveSelectedItem() {
  const entry = state.entries.find((item) => item.id === selectedId);
  if (!entry) return;
  entry.name = els.itemName.value.trim() || entry.name;
  entry.notes = els.itemNotes.value.trim();
  if (entry.type === "house") entry.completed = els.itemComplete.checked;
  persist();
  selectedId = null;
  els.itemDialog.close();
  render();
}

function deleteSelectedItem() {
  state.entries = state.entries.filter((item) => item.id !== selectedId);
  persist();
  selectedId = null;
  els.itemDialog.close();
  render();
  showToast("Deleted.");
}

function clearCompletedDrops() {
  const before = state.entries.length;
  state.entries = state.entries.filter((entry) => entry.type !== "house" || !entry.completed);
  if (state.entries.length === before) {
    showToast("No completed houses to clear.");
    return;
  }
  persist();
  render();
  showToast("Completed houses cleared.");
}

function clearAllSaved() {
  if (!state.entries.length) {
    showToast("No saved items to clear.");
    return;
  }
  cancelDraftPin();
  selectedId = null;
  state.entries = [];
  persist();
  render();
  showToast("All saved items cleared.");
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `routeledger-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state = normalizeState(JSON.parse(reader.result));
      persist();
      location.reload();
    } catch {
      showToast("That file could not be imported.");
    }
  };
  reader.readAsText(file);
}

function showToast(message) {
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}
