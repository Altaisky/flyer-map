const STORAGE_KEY = 'flyer-map-buildings';
const SETTINGS_KEY = 'flyer-map-settings';

const DEFAULT_CENTER = [55.7558, 37.6173];
const DEFAULT_ZOOM = 15;
const DEFAULT_COOLDOWN = 30;

let buildings = [];
let map;
let markers = {};
let currentFilter = 'all';
let nextId = 1;
let blockMapClick = false;
let isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
let locationMarker = null;
let locationCircle = null;
let isTracking = false;

function reverseGeocode(lat, lng, callback) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=ru`);
  xhr.setRequestHeader('User-Agent', 'FlyerMap-PWA/1.0');
  xhr.onload = function() {
    if (xhr.status === 200) {
      try {
        const data = JSON.parse(xhr.responseText);
        callback(data);
      } catch (e) {
        callback(null);
      }
    } else {
      callback(null);
    }
  };
  xhr.onerror = function() { callback(null); };
  xhr.send();
}

function formatAddress(data) {
  if (!data || !data.address) return null;
  const a = data.address;
  const street = a.road || a.footway || a.pedestrian || a.path || '';
  const house = a.house_number || '';
  if (street && house) return `${street}, ${house}`;
  if (street) return street;
  if (house) return `Дом ${house}`;
  return data.display_name ? data.display_name.split(',')[0] : null;
}

function setBlockMapClick() {
  blockMapClick = true;
  setTimeout(() => { blockMapClick = false; }, 100);
}

function isSidebarOpen() {
  return document.getElementById('sidebar').classList.contains('open');
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { cooldownDays: DEFAULT_COOLDOWN, center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
}

function saveSettings() {
  const settings = {
    cooldownDays: parseInt(document.getElementById('cooldown-days').value) || DEFAULT_COOLDOWN,
    center: map.getCenter(),
    zoom: map.getZoom()
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadBuildings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      buildings = JSON.parse(raw);
      if (buildings.length > 0) {
        nextId = Math.max(...buildings.map(b => b.id)) + 1;
      }
    }
  } catch (e) {
    buildings = [];
  }
}

function saveBuildings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(buildings));
}

function getStatus(building) {
  if (building.excluded) return 'excluded';
  if (building.status === 'planned') return 'planned';
  if (!building.lastMarkedAt) return 'pending';
  const cooldownDays = parseInt(document.getElementById('cooldown-days').value) || DEFAULT_COOLDOWN;
  const markedDate = new Date(building.lastMarkedAt);
  const expiryDate = new Date(markedDate.getTime() + cooldownDays * 24 * 60 * 60 * 1000);
  return new Date() >= expiryDate ? 'expired' : 'active';
}

function getRemainingText(building) {
  if (!building.lastMarkedAt) return null;
  const cooldownDays = parseInt(document.getElementById('cooldown-days').value) || DEFAULT_COOLDOWN;
  const markedDate = new Date(building.lastMarkedAt);
  const expiryDate = new Date(markedDate.getTime() + cooldownDays * 24 * 60 * 60 * 1000);
  const diff = expiryDate - new Date();
  if (diff <= 0) return 'Готов к повторной обклейке!';
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
  return `Осталось ${days} дн.`;
}

function createMarkerIcon(status) {
  const size = isMobile ? 32 : 24;
  return L.divIcon({
    className: `marker-icon marker-${status}`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2]
  });
}

function getPopupContent(building) {
  const status = getStatus(building);
  const statusLabels = {
    pending: 'Новый',
    planned: 'Обклеить',
    active: 'Обклеено',
    expired: 'Готов снова',
    excluded: 'Исключён'
  };
  const remaining = getRemainingText(building);
  const markedDate = building.lastMarkedAt
    ? new Date(building.lastMarkedAt).toLocaleDateString('ru-RU')
    : null;

  let html = `<div class="popup-content">`;
  html += `<h3>Дом #${building.id}</h3>`;
  if (building.address) {
    html += `<div class="building-address">${building.address}</div>`;
  } else if (!building.addressFetching) {
    html += `<div class="building-address loading">Загрузка адреса...</div>`;
  }
  html += `<span class="status status-${status}">${statusLabels[status]}</span>`;
  if (markedDate) {
    html += `<div class="timer">Обклеен: ${markedDate}</div>`;
  }
  if (remaining) {
    html += `<div class="timer">${remaining}</div>`;
  }

  html += `<a class="popup-btn popup-btn-nav" href="geo:${building.lat},${building.lng}" target="_blank">Навигация</a>`;

  html += `<div class="popup-actions">`;

  const showGlue = status === 'pending' || status === 'expired';
  const showDone = status === 'pending' || status === 'planned' || status === 'expired';
  const showExclude = status !== 'excluded';

  if (showGlue) {
    html += `<button class="popup-btn popup-btn-mark" onclick="planBuilding(${building.id})">Обклеить</button>`;
  }
  if (showDone) {
    html += `<button class="popup-btn popup-btn-done" onclick="doneBuilding(${building.id})">Обклеено</button>`;
  }
  if (showExclude) {
    html += `<button class="popup-btn popup-btn-exclude" onclick="excludeBuilding(${building.id})">Исключить</button>`;
  }
  html += `<button class="popup-btn popup-btn-delete" onclick="deleteBuilding(${building.id})">Удалить</button>`;
  html += `</div></div>`;

  return html;
}

function addMarkerToMap(building) {
  const status = getStatus(building);
  const marker = L.marker([building.lat, building.lng], {
    icon: createMarkerIcon(status)
  }).addTo(map);

  marker.bindPopup(() => getPopupContent(building), { maxWidth: 250 });
  markers[building.id] = marker;
}

function refreshMarker(building) {
  const marker = markers[building.id];
  if (!marker) return;
  const status = getStatus(building);
  marker.setIcon(createMarkerIcon(status));
  marker.setPopupContent(getPopupContent(building));
}

function refreshAllMarkers() {
  buildings.forEach(b => {
    refreshMarker(b);
    applyFilterToMarker(b);
  });
  updateStats();
}

function applyFilterToMarker(building) {
  const marker = markers[building.id];
  if (!marker) return;
  const status = getStatus(building);
  const visible = currentFilter === 'all' || status === currentFilter;
  if (visible) {
    if (!map.hasLayer(marker)) marker.addTo(map);
  } else {
    if (map.hasLayer(marker)) map.removeLayer(marker);
  }
}

function updateStats() {
  const counts = { pending: 0, planned: 0, active: 0, expired: 0, excluded: 0 };
  buildings.forEach(b => { counts[getStatus(b)]++; });
  document.getElementById('count-pending').textContent = counts.pending;
  document.getElementById('count-planned').textContent = counts.planned;
  document.getElementById('count-active').textContent = counts.active;
  document.getElementById('count-expired').textContent = counts.expired;
  document.getElementById('count-excluded').textContent = counts.excluded;
  document.getElementById('count-total').textContent = buildings.length;
}

function initMap() {
  const settings = loadSettings();

  map = L.map('map', {
    center: settings.center,
    zoom: settings.zoom,
    zoomControl: true
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  document.getElementById('cooldown-days').value = settings.cooldownDays;

  map.on('click', function(e) {
    if (blockMapClick) {
      blockMapClick = false;
      return;
    }
    if (isMobile && isSidebarOpen()) {
      closeSidebar();
      return;
    }
    const building = {
      id: nextId++,
      lat: Math.round(e.latlng.lat * 1000000) / 1000000,
      lng: Math.round(e.latlng.lng * 1000000) / 1000000,
      status: 'pending',
      excluded: false,
      address: null,
      lastMarkedAt: null,
      createdAt: new Date().toISOString()
    };
    buildings.push(building);
    addMarkerToMap(building);
    applyFilterToMarker(building);
    saveBuildings();
    updateStats();
    markers[building.id].openPopup();

    building.addressFetching = true;
    reverseGeocode(building.lat, building.lng, function(data) {
      building.address = formatAddress(data);
      building.addressFetching = false;
      refreshMarker(building);
      saveBuildings();
    });
  });

  map.on('moveend zoomend', saveSettings);

  map.on('locationfound', function(e) {
    if (locationMarker) map.removeLayer(locationMarker);
    if (locationCircle) map.removeLayer(locationCircle);
    const radius = e.accuracy / 2;
    locationMarker = L.circleMarker(e.latlng, {
      radius: 8,
      fillColor: '#3498db',
      fillOpacity: 1,
      color: '#fff',
      weight: 3
    });
    locationCircle = L.circle(e.latlng, {
      radius: radius,
      color: '#3498db',
      fillColor: '#3498db',
      fillOpacity: 0.15,
      weight: 2
    });
    if (isTracking) {
      locationMarker.addTo(map);
      locationCircle.addTo(map);
    }
  });

  map.on('locationerror', function() {
    alert('Не удалось определить местоположение. Проверьте, включена ли геолокация на устройстве.');
    const btn = document.getElementById('btn-locate');
    stopLocating(btn);
  });

  loadBuildings();
  buildings.forEach(b => {
    if (b.status === undefined) b.status = 'pending';
    if (b.excluded === undefined) b.excluded = false;
    if (b.address === undefined) b.address = null;
  });
  buildings.forEach(function(b) {
    addMarkerToMap(b);
    if (!b.address && !b.addressFetching) {
      b.addressFetching = true;
      reverseGeocode(b.lat, b.lng, function(data) {
        b.address = formatAddress(data);
        b.addressFetching = false;
        refreshMarker(b);
        saveBuildings();
      });
    }
  });
  refreshAllMarkers();
}

window.planBuilding = function(id) {
  setBlockMapClick();
  const building = buildings.find(b => b.id === id);
  if (!building) return;
  map.closePopup();
  building.status = 'planned';
  building.excluded = false;
  building.lastMarkedAt = null;
  refreshMarker(building);
  applyFilterToMarker(building);
  saveBuildings();
  updateStats();
};

window.doneBuilding = function(id) {
  setBlockMapClick();
  const building = buildings.find(b => b.id === id);
  if (!building) return;
  map.closePopup();
  building.status = 'done';
  building.excluded = false;
  building.lastMarkedAt = new Date().toISOString();
  refreshMarker(building);
  applyFilterToMarker(building);
  saveBuildings();
  updateStats();
};

window.excludeBuilding = function(id) {
  setBlockMapClick();
  const building = buildings.find(b => b.id === id);
  if (!building) return;
  map.closePopup();
  building.excluded = true;
  building.status = 'excluded';
  building.lastMarkedAt = null;
  refreshMarker(building);
  applyFilterToMarker(building);
  saveBuildings();
  updateStats();
};

window.deleteBuilding = function(id) {
  setBlockMapClick();
  map.closePopup();
  if (!confirm('Удалить этот дом?')) return;
  const marker = markers[id];
  if (marker) {
    map.removeLayer(marker);
    delete markers[id];
  }
  buildings = buildings.filter(b => b.id !== id);
  saveBuildings();
  updateStats();
};

document.getElementById('cooldown-days').addEventListener('change', function() {
  saveSettings();
  refreshAllMarkers();
});

document.querySelectorAll('.btn-filter').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    currentFilter = this.dataset.filter;
    refreshAllMarkers();
  });
});

document.getElementById('btn-export').addEventListener('click', function() {
  const data = {
    buildings: buildings,
    settings: loadSettings(),
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `flyer-map-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('btn-import').addEventListener('click', function() {
  document.getElementById('file-import').click();
});

document.getElementById('file-import').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    try {
      const data = JSON.parse(ev.target.result);
      if (data.buildings && Array.isArray(data.buildings)) {
        Object.values(markers).forEach(m => map.removeLayer(m));
        markers = {};
        buildings = data.buildings;
        buildings.forEach(b => {
          if (b.status === undefined) b.status = 'pending';
          if (b.excluded === undefined) b.excluded = false;
        });
        nextId = buildings.length > 0 ? Math.max(...buildings.map(b => b.id)) + 1 : 1;
        buildings.forEach(b => addMarkerToMap(b));
        if (data.settings && data.settings.cooldownDays) {
          document.getElementById('cooldown-days').value = data.settings.cooldownDays;
        }
        saveBuildings();
        saveSettings();
        refreshAllMarkers();
        alert(`Импортировано ${buildings.length} домов`);
      } else {
        alert('Неверный формат файла');
      }
    } catch (err) {
      alert('Ошибка чтения файла: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

setInterval(refreshAllMarkers, 60000);

document.getElementById('sidebar-toggle').addEventListener('click', openSidebar);
document.getElementById('sidebar-close').addEventListener('click', closeSidebar);
document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);

document.getElementById('btn-locate').addEventListener('click', function() {
  const btn = this;
  if (isTracking) {
    stopLocating(btn);
    return;
  }
  if (!map) return;
  map.locate({ setView: true, maxZoom: 17, watch: true, enableHighAccuracy: true });
  btn.classList.add('tracking');
  btn.textContent = '\u2715';
  isTracking = true;
});

function stopLocating(btn) {
  map.stopLocate();
  if (locationMarker) { map.removeLayer(locationMarker); locationMarker = null; }
  if (locationCircle) { map.removeLayer(locationCircle); locationCircle = null; }
  isTracking = false;
  btn.classList.remove('tracking');
  btn.textContent = '\u2316';
}

initMap();
