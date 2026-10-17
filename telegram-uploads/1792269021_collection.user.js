// ==UserScript==
// @name         Kino.watch Collection
// @namespace    https://github.com/vkdsk/kinowatch-collection
// @version      1.4
// @description  Поиск коллекции фильмов (сиквелов и приквелов) для kimo.watch
// @author       etodsk
// @icon         https://m.staticpop.net/logo.png
// @homepageURL  https://github.com/vkdsk/kinowatch-collection
// @supportURL   https://t.me/etodsk
// @updateURL    https://kw.xlnt.ovh/collection.user.js
// @downloadURL  https://kw.xlnt.ovh/collection.user.js
// @match        https://kino.watch/item/view/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      imdb.com
// @connect      api.themoviedb.org
// @connect      raw.githubusercontent.com
// @connect      kino.watch
// ==/UserScript==

(function() {
    'use strict';

    // Настройка логов: 1 — включено, 0 — выключено по умолчанию
    const DEBUG = 1;

    function log(...args) {
        if (DEBUG) {
            console.log("[Kinopub Script]:", ...args);
        }
    }

    log("Скрипт запущен на странице:", window.location.pathname);

    // 1. Проверка сезона в URL: если это сериал (s1, s2...), прерываем работу
    const seasonMatch = window.location.pathname.match(/\/s(\d+)e\d+/i);
    if (seasonMatch && seasonMatch[1] !== '0') {
        log("Обнаружен сериал (сезон > 0), прерываем работу.");
        return;
    }

    // 2. Извлекаем ID текущего фильма из URL
    const currentIdMatch = window.location.pathname.match(/\/item\/view\/(\d+)/);
    const currentFilmId = currentIdMatch ? currentIdMatch[1] : null;

    // 3. Ищем ссылку на IMDb на странице
    const imdbLinkEl = document.querySelector('a[href*="imdb.com/title/"]');
    if (!imdbLinkEl) {
        log("Ссылка на IMDb не найдена на странице.");
        return;
    }

    const imdbMatch = imdbLinkEl.href.match(/title\/(tt\d+)/);
    if (!imdbMatch) return;

    const imdbId = imdbMatch[1];
    log("Найден IMDb ID:", imdbId);

    // Функция жесткой нормализации: только буквы и цифры, в нижний регистр, без пробелов и спецсимволов
    function strictNormalize(str) {
        if (!str) return '';
        return str
            .toLowerCase()
            .replace(/ё/g, 'е')
            .replace(/[^a-zа-я0-9]/gi, '');
    }

    // 4. Получаем TMDB ключ с кэшированием до перезапуска браузера
    getTmdbApiKey(function(apiKey) {
        if (!apiKey) {
            console.error("[Kinopub Script]: Не удалось получить TMDB API ключ");
            return;
        }
        fetchCollectionInfo(imdbId, apiKey);
    });

    function getTmdbApiKey(callback) {
        const cachedKey = GM_getValue('tmdb_api_key', null);
        if (cachedKey) {
            callback(cachedKey);
            return;
        }

        let maxNum = 5;
        GM_xmlhttpRequest({
            method: "GET",
            url: "https://raw.githubusercontent.com/kino-watch-mod/hash/refs/heads/main/count",
            timeout: 3000,
            onload: function(res) {
                if (res.status === 200 && /^\d+$/.test(res.responseText.trim())) {
                    maxNum = parseInt(res.responseText.trim(), 10);
                }
                fetchKeyFile(Math.floor(Math.random() * maxNum) + 1, callback);
            },
            onerror: function() {
                fetchKeyFile(1, callback);
            }
        });
    }

    function fetchKeyFile(num, callback) {
        GM_xmlhttpRequest({
            method: "GET",
            url: `https://raw.githubusercontent.com/kino-watch-mod/hash/refs/heads/main/${num}`,
            timeout: 5000,
            onload: function(res) {
                let key = "818405a0e71c4cab9de904fce9c231bb";
                if (res.status === 200 && res.responseText.trim()) {
                    key = res.responseText.trim();
                }
                GM_setValue('tmdb_api_key', key);
                callback(key);
            },
            onerror: function() {
                const fallbackKey = "818405a0e71c4cab9de904fce9c231bb";
                GM_setValue('tmdb_api_key', fallbackKey);
                callback(fallbackKey);
            }
        });
    }

    // 5. Запросы к TMDB через fetch
    function tmdbRequest(endpoint, params, apiKey, lang, callback) {
        params.api_key = apiKey;
        params.language = lang;
        const query = new URLSearchParams(params).toString();
        const url = `https://api.themoviedb.org/3${endpoint}?${query}`;

        fetch(url)
            .then(res => res.ok ? res.json() : null)
            .then(data => callback(data))
            .catch(() => callback(null));
    }

    function fetchCollectionInfo(imdbId, apiKey) {
        tmdbRequest(`/find/${imdbId}`, { external_source: 'imdb_id' }, apiKey, 'en-US', function(findData) {
            if (!findData || !findData.movie_results || findData.movie_results.length === 0) return;

            const movieId = findData.movie_results[0].id;

            tmdbRequest(`/movie/${movieId}`, { append_to_response: 'belongs_to_collection' }, apiKey, 'en-US', function(movieEn) {
                if (!movieEn) return;

                tmdbRequest(`/movie/${movieId}`, {}, apiKey, 'ru-RU', function(movieRu) {
                    const collection = movieEn.belongs_to_collection;

                    if (!collection) {
                        const year = movieEn.release_date ? parseInt(movieEn.release_date.substring(0, 4), 10) : null;
                        if (!year) return;

                        const titleRu = (movieRu && movieRu.title) ? movieRu.title : movieEn.title;
                        createCollectionUI("Связанные фильмы", [{
                            title: movieEn.title,
                            title_ru: titleRu,
                            year: year,
                            imdb: imdbId
                        }]);
                        return;
                    }

                    tmdbRequest(`/collection/${collection.id}`, {}, apiKey, 'en-US', function(collEn) {
                        tmdbRequest(`/collection/${collection.id}`, {}, apiKey, 'ru-RU', function(collRu) {
                            if (!collEn || !collEn.parts) return;

                            const ruTitlesMap = {};
                            if (collRu && collRu.parts) {
                                collRu.parts.forEach(p => { ruTitlesMap[p.id] = p.title; });
                            }

                            let loadedCount = 0;
                            const allFilms = [];

                            collEn.parts.forEach((part, index) => {
                                tmdbRequest(`/movie/${part.id}`, {}, apiKey, 'en-US', function(partDetails) {
                                    const partImdb = partDetails ? partDetails.imdb_id : null;
                                    const titleRu = ruTitlesMap[part.id] || part.title;
                                    const year = part.release_date ? parseInt(part.release_date.substring(0, 4), 10) : null;

                                    allFilms[index] = {
                                        title: part.title,
                                        title_ru: titleRu,
                                        year: year,
                                        imdb: partImdb,
                                        tmdb_id: part.id
                                    };

                                    loadedCount++;
                                    if (loadedCount === collEn.parts.length) {
                                        const validFilms = allFilms.filter(film => film && film.year);
                                        validFilms.sort((a, b) => a.year - b.year);

                                        const collName = (collRu && collRu.name) ? collRu.name.replace(' (Коллекция)', '') : collection.name;
                                        createCollectionUI(collName, validFilms);
                                    }
                                });
                            });
                        });
                    });
                });
            });
        });
    }

    // 6. Отрисовка интерфейса под плеером
    function createCollectionUI(collectionName, films) {
        const targetContainer = document.querySelector('.player-shell') || document.querySelector('media-player') || document.querySelector('#player') || document.querySelector('.iv-head');
        if (!targetContainer) return;

        const wrapper = document.createElement('div');
        wrapper.style.cssText = `
            margin: 20px 0;
            padding: 12px 14px;
            background: #1b1e28;
            border-radius: 10px;
            border: 1px solid rgba(255,255,255,0.1);
        `;

        const title = document.createElement('div');
        title.style.cssText = `
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 10px;
            color: #a3aabd;
        `;
        title.innerText = `Коллекция: ${collectionName}`;
        wrapper.appendChild(title);

        const buttonsFlex = document.createElement('div');
        buttonsFlex.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        `;
        wrapper.appendChild(buttonsFlex);

        targetContainer.insertAdjacentElement('afterend', wrapper);

        films.forEach(film => {
            const btn = document.createElement('a');
            const displayName = film.title_ru || film.title;
            btn.innerText = `${displayName} (${film.year})`;
            btn.style.cssText = `
                display: inline-block;
                padding: 6px 12px;
                border-radius: 7px;
                font-size: 13px;
                font-weight: 600;
                text-decoration: none;
                transition: 0.15s;
                background: #20232f;
                border: 1px solid rgba(255,255,255,0.09);
                color: #8b91a3;
                opacity: 0.6;
                pointer-events: none;
            `;

            buttonsFlex.appendChild(btn);
            searchFilmWithPagination(film, btn);
        });
    }

    // 7. Поиск с пагинацией и диапазоном годов (±1)
    function searchFilmWithPagination(film, btnElement) {
        searchWithQueryAndPage(film.title, film, 1, function(success) {
            if (success) {
                applyFoundStyle(btnElement, success);
            } else if (film.title_ru && film.title_ru !== film.title) {
                searchWithQueryAndPage(film.title_ru, film, 1, function(ruSuccess) {
                    if (ruSuccess) {
                        applyFoundStyle(btnElement, ruSuccess);
                    } else {
                        btnElement.style.textDecoration = 'line-through';
                        btnElement.title = 'Не найдено точного совпадения на сайте';
                    }
                });
            } else {
                btnElement.style.textDecoration = 'line-through';
                btnElement.title = 'Не найдено точного совпадения на сайте (или доступны только 3D)';
            }
        });
    }

    function searchWithQueryAndPage(queryText, film, pageNum, callback) {
        const searchUrl = `https://kino.watch/item/search?query=${encodeURIComponent(queryText)}&page=${pageNum}`;
        log(`Запрос поиска: ${searchUrl}`);

        GM_xmlhttpRequest({
            method: "GET",
            url: searchUrl,
            onload: function(response) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(response.responseText, "text/html");

                let totalPages = 1;
                if (pageNum === 1) {
                    const matchHeader = doc.body.textContent.match(/найдено\s+(\d+)\s+совпадения?/i) || doc.body.textContent.match(/найдено\s+(\d+)\s+совпадений/i);
                    if (matchHeader) {
                        const totalCount = parseInt(matchHeader[1], 10);
                        totalPages = Math.ceil(totalCount / 20);
                        log(`Найдено всего совпадений: ${totalCount}, страниц для обхода: ${totalPages}`);
                    }
                }

                const items = doc.querySelectorAll('.item.r');
                let foundUrl = null;

                const targetNormTitleEn = strictNormalize(film.title);
                const targetNormTitleRu = strictNormalize(film.title_ru);

                items.forEach(item => {
                    if (foundUrl) return;

                    const labelEl = item.querySelector('.item-title .label');
                    if (labelEl && labelEl.textContent.trim() === '3D') return;

                    // Проверяем диапазон годов: от (film.year - 1) до (film.year + 1)
                    let foundValidYear = false;
                    for (let y = film.year - 1; y <= film.year + 1; y++) {
                        if (item.textContent.includes(y.toString())) {
                            foundValidYear = true;
                            break;
                        }
                    }
                    if (!foundValidYear) return;

                    // Извлекаем названия с сайта и тоже нормализуем их (оставляем только буквы и цифры)
                    const titleRuEl = item.querySelector('.item-title a');
                    const titleEnEl = item.querySelector('.item-author a');

                    const siteTitleRuNorm = titleRuEl ? strictNormalize(titleRuEl.getAttribute('title') || titleRuEl.textContent) : '';
                    const siteTitleEnNorm = titleEnEl ? strictNormalize(titleEnEl.getAttribute('title') || titleEnEl.textContent) : '';

                    // Строгое сравнение очищенных названий
                    const isStrictMatch = (
                        (siteTitleRuNorm && (siteTitleRuNorm === targetNormTitleRu || siteTitleRuNorm === targetNormTitleEn)) ||
                        (siteTitleEnNorm && (siteTitleEnNorm === targetNormTitleEn || siteTitleEnNorm === targetNormTitleRu))
                    );

                    if (isStrictMatch) {
                        const linkEl = item.querySelector('a[href*="/item/view/"]');
                        if (linkEl) {
                            foundUrl = linkEl.getAttribute('href');
                        }
                    }
                });

                if (foundUrl) {
                    callback(foundUrl);
                } else if (pageNum < totalPages && pageNum < 5) {
                    log(`На странице ${pageNum} фильм не найден, переходим на страницу ${pageNum + 1}...`);
                    searchWithQueryAndPage(queryText, film, pageNum + 1, callback);
                } else {
                    callback(null);
                }
            },
            onerror: function() {
                callback(null);
            }
        });
    }

    function applyFoundStyle(btnElement, foundUrl) {
        const foundIdMatch = foundUrl.match(/\/item\/view\/(\d+)/);
        const foundId = foundIdMatch ? foundIdMatch[1] : null;

        btnElement.href = foundUrl;
        btnElement.style.pointerEvents = 'auto';
        btnElement.style.opacity = '1';

        const isCurrent = currentFilmId && foundId && (currentFilmId === foundId);

        if (isCurrent) {
            btnElement.style.background = 'rgba(42,192,127,0.18)';
            btnElement.style.border = '1px solid rgba(42,192,127,0.5)';
            btnElement.style.color = '#2ac07f';
        } else {
            btnElement.style.color = '#e9ebf1';

            btnElement.addEventListener('mouseenter', () => {
                btnElement.style.background = '#262a38';
                btnElement.style.borderColor = 'rgba(255,255,255,0.2)';
            });
            btnElement.addEventListener('mouseleave', () => {
                btnElement.style.background = '#20232f';
                btnElement.style.borderColor = 'rgba(255,255,255,0.09)';
            });
        }
    }

})();