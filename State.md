# Состояние проекта: Map

_Обновлено: 2026-05-22_

## Кратко
PWA на чистом HTML/CSS/JS + Leaflet + OpenStreetMap. Карта города с маркерами домов. 4 статуса, таймер кд, комментарии, геолокация, обратный геокодинг. Развёрнуто на GitHub Pages, устанавливается на телефон как нативное приложение (офлайн).

## Стек и зависимости
- Фронтенд: Vanilla HTML + CSS + JavaScript (без сборки)
- Карта: Leaflet 1.9.4 (CDN)
- Тайлы: OpenStreetMap
- Геокодинг: Nominatim (OSM)
- Хранение: localStorage
- PWA: manifest.json + Service Worker (сеть-first для HTML, кэш-first для CDN)
- Хостинг: GitHub Pages (бесплатно)

## Структура репозитория
- `index.html` — главная страница, PWA-манифест, SW-регистрация
- `css/style.css` — тёмная тема, сайдбар-ящик, попапы, адаптив (≤768px)
- `js/app.js` — вся логика: карта, статусы, таймер, комментарии, геолокация, экспорт/импорт
- `sw.js` — Service Worker: сеть-first (HTML), кэш-first (CDN), сеть-first (своё)
- `manifest.json` — PWA-манифест
- `icons/` — иконки 192×192 и 512×512

## Ключевые сущности

### Building (дом)
```js
{
  id: number,
  lat: number, lng: number,
  status: 'planned' | 'done' | 'excluded' | 'commented',
  excluded: boolean,
  cooldownDays: number | null,
  lastMarkedAt: string | null,
  address: string | null,
  comment: string | null,
  createdAt: string
}
```

### Вычисляемые статусы (`getStatus()`)
- `active` (🟢 зелёный) — status='done', таймер не истёк
- `planned` (🟠 оранжевый) — status='planned' или status='done' и таймер истёк
- `excluded` (⚪ серый) — excluded=true
- `commented` (🟣 фиолетовый) — status='commented'
- Индикатор комментария: золотая точка (::after) если есть comment или status='commented'

### Создание дома
1. Клик по карте → временный серый маркер + карточка выбора
2. 💬 → prompt комментария → обновляется попап и иконка маркера
3. Обклеить/Обклеено/Исключить → дом создаётся с выбранным статусом
4. Закрыть попап с комментарием → авто-сохранение со статусом 'commented'
5. Закрыть попап без комментария → маркер удаляется

### Действия в попапе существующего дома
- `planBuilding(id)` — переводит в planned
- `doneBuilding(id)` — ставит lastMarkedAt, запускает таймер
- `excludeBuilding(id)` — excluded=true
- `deleteBuilding(id)` — удаляет безвозвратно
- `addComment(id)` — prompt редактирования комментария

## Точки входа и сценарии запуска
- Деплой: `git push` → GitHub Pages
- Локально: открыть `index.html` в браузере (файловая система)
- Телефон: https://altaisky.github.io/flyer-map/ → «На экран Домой»

## Состояние работы
- Стабильно: карта, 4 статуса, таймер, комментарии, фильтрация, экспорт/импорт, PWA, геолокация, геокодинг
- Известные проблемы: тайлы OSM без интернета не грузятся (только закэшированные), Nominatim может не найти номер дома

## Заметки для будущего себя
- ⚠ **НИКОГДА не использовать `...` в edit newString/oldString** — инструмент вставляет это как литерал, ломает HTML
- `blockMapClick` с авто-сбросом 100мс — от всплытия кликов попапа в карту
- `tempMarker/tempComment` — временные данные при создании дома, очищаются в `removeTempMarker()`
- В `confirmNewBuilding` комментарий копируется в локальную переменную ДО вызова `removeTempMarker()`
- `isMobile` = `'ontouchstart' in window`, влияет на размер маркеров (24px/32px)
- Мобильный сайдбар: `transform: translateX(-100%)` + `.open`, оверлей, `body.sidebar-open`
- Зум перенесён в `bottomright`, гамбургер в `bottomleft`, кнопка закрытия сайдбара там же
- Обратная совместимость: отсутствующие поля (`status`, `excluded`, `address`, `comment`) подставляются при загрузке
- `setInterval(refreshAllMarkers, 60000)` — переход active→planned раз в минуту
- SW: `updateViaCache: 'none'`, HTML — сеть-first, CDN — кэш-first, остальное — сеть-first
- Кэш SW бампается с каждой версией (`flyer-map-v21`)
