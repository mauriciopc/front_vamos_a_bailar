import React, { useState, useEffect, useCallback, useRef } from 'react';
import './SpotiList.css';

// --- CONFIGURACIÓN ---
const clientId = "fb8cef2d33f04f929c1f1361aa9a30d9";
const redirectUri = window.location.origin + window.location.pathname;

// --- Componente SongItem ---
const SongItem = ({ track, listId, onRemove }) => (
    <div className="song-item" data-track-id={track.id}>
        <div className="song-info">
            <p className="song-name">{track.name}</p>
            <p className="song-artist">{track.artist}</p>
        </div>
        <button onClick={() => onRemove(listId, track.id)} className="remove-button">&times;</button>
    </div>
);

// --- Componente SongList ---
const SongList = ({ listId, songs = [], onSort, onRemove }) => {
    const listTitle = `Lista ${listId.split('-')[1]}`;
    const sortableRef = useRef(null);

    useEffect(() => {
        if (window.Sortable && sortableRef.current) {
            const sortable = new window.Sortable(sortableRef.current, {
                group: 'shared',
                animation: 150,
                ghostClass: 'song-item-ghost',
                delay: 150,
                delayOnTouchOnly: true,
                onEnd: (evt) => {
                    const { from, to, oldIndex, newIndex } = evt;
                    onSort({
                        fromListId: from.id,
                        toListId: to.id,
                        oldIndex,
                        newIndex
                    });
                },
            });
            return () => sortable.destroy();
        }
    }, [onSort, songs]);

    const safeSongs = Array.isArray(songs) ? songs : [];
    const listKey = safeSongs.map(s => s.id).join(',');

    return (
        <div className="list-container">
            <h3>{listTitle}</h3>
            <div id={listId} ref={sortableRef} className="song-list" key={listKey}>
                {safeSongs.map(track => (
                    <SongItem
                        key={track.id}
                        track={track}
                        listId={listId}
                        onRemove={onRemove}
                    />
                ))}
            </div>
        </div>
    );
};


// --- Componente Principal ---
function App() {
    const [accessToken, setAccessToken] = useState(localStorage.getItem('spotify_access_token'));
    const [songLists, setSongLists] = useState({ 'list-1': [], 'list-2': [], 'list-3': [] });
    const [searchResults, setSearchResults] = useState([]);
    const [nowPlaying, setNowPlaying] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');

    // Refs para mantener estado actualizado en callbacks
    const songListsRef = useRef(songLists);
    const playbackIntervalId = useRef(null);
    const lastTrackUri = useRef(null);
    const isPlayingFromApp = useRef(false);
    const regenerateQueueRef = useRef(null);
    const nextListIndex = useRef(0); // 0=list-1, 1=list-2, 2=list-3

    // Set para rastrear canciones ya encoladas y evitar duplicados (por URI)
    const queuedSongs = useRef(new Set());

    // Actualizar ref cuando cambia el estado
    useEffect(() => {
        songListsRef.current = songLists;
        localStorage.setItem('spotify_song_lists', JSON.stringify(songLists));
    }, [songLists]);

    // Recuperar listas al inicio
    useEffect(() => {
        const savedLists = localStorage.getItem('spotify_song_lists');
        if (savedLists) {
            try {
                const parsed = JSON.parse(savedLists);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    const safeLists = {
                        'list-1': Array.isArray(parsed['list-1']) ? parsed['list-1'] : [],
                        'list-2': Array.isArray(parsed['list-2']) ? parsed['list-2'] : [],
                        'list-3': Array.isArray(parsed['list-3']) ? parsed['list-3'] : [],
                    };
                    setSongLists(safeLists);
                }
            } catch (e) {
                console.error("Error parsing saved lists", e);
            }
        }
    }, []);

    // Manejar el código de autorización al regresar de Spotify
    useEffect(() => {
        const args = new URLSearchParams(window.location.search);
        const code = args.get('code');

        if (code) {
            const codeVerifier = localStorage.getItem('code_verifier');
            const body = new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: redirectUri,
                client_id: clientId,
                code_verifier: codeVerifier
            });

            fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body
            })
                .then(response => {
                    if (!response.ok) throw new Error('HTTP status ' + response.status);
                    return response.json();
                })
                .then(data => {
                    localStorage.setItem('spotify_access_token', data.access_token);
                    if (data.refresh_token) {
                        localStorage.setItem('spotify_refresh_token', data.refresh_token);
                    }
                    const expiryTime = Date.now() + data.expires_in * 1000;
                    localStorage.setItem('spotify_token_expiry', expiryTime.toString());

                    setAccessToken(data.access_token);
                    // Limpiar URL
                    window.history.replaceState({}, document.title, window.location.pathname);
                })
                .catch(error => {
                    console.error('Error durante el intercambio de token:', error);
                });
        }
    }, []);

    const getValidToken = useCallback(async () => {
        const expiry = localStorage.getItem('spotify_token_expiry');
        if (expiry && Date.now() < Number(expiry)) {
            return localStorage.getItem('spotify_access_token');
        }
        const refreshToken = localStorage.getItem('spotify_refresh_token');
        if (!refreshToken) return null;
        try {
            const response = await fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: refreshToken,
                    client_id: clientId
                }),
            });
            if (!response.ok) throw new Error('Failed to refresh token');
            const data = await response.json();
            const expiryTime = Date.now() + data.expires_in * 1000;
            localStorage.setItem('spotify_access_token', data.access_token);
            localStorage.setItem('spotify_token_expiry', expiryTime.toString());
            if (data.refresh_token) {
                localStorage.setItem('spotify_refresh_token', data.refresh_token);
            }
            setAccessToken(data.access_token);
            return data.access_token;
        } catch (error) {
            console.error('Error refreshing access token:', error);
            localStorage.clear();
            setAccessToken(null);
            return null;
        }
    }, []);

    const fetchWebApi = useCallback(async (endpoint, method, body) => {
        const currentToken = await getValidToken();
        if (!currentToken) {
            setAccessToken(null);
            return;
        }

        const fetchOptions = {
            headers: { 'Authorization': `Bearer ${currentToken}` },
            method
        };

        // Solo agregar body si existe y no es undefined
        if (body !== undefined) {
            fetchOptions.body = JSON.stringify(body);
        }

        const res = await fetch(`https://api.spotify.com/${endpoint}`, fetchOptions);

        if (res.ok) {
            // Manejar 204 No Content explícitamente
            if (res.status === 204) return null;
            // Intentar parsear JSON, si falla devolver null (para evitar errores de sintaxis)
            try {
                return await res.json();
            } catch (e) {
                console.warn("Respuesta no es JSON válido, pero status ok:", res.status);
                return null;
            }
        } else {
            const errorText = await res.text();
            console.error('Error con la API de Spotify:', res.status, errorText);
            if (res.status === 401) {
                setAccessToken(null);
                localStorage.clear();
            }
            throw new Error('Spotify API Error');
        }
    }, [getValidToken]);

    const redirectToLogin = async () => {
        const generateRandomString = (length) => {
            let text = '';
            const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            for (let i = 0; i < length; i++) { text += possible.charAt(Math.floor(Math.random() * possible.length)); }
            return text;
        };
        const generateCodeChallenge = async (codeVerifier) => {
            const data = new TextEncoder().encode(codeVerifier);
            const digest = await window.crypto.subtle.digest('SHA-256', data);
            return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
                .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        };
        const codeVerifier = generateRandomString(128);
        const codeChallenge = await generateCodeChallenge(codeVerifier);
        localStorage.setItem('code_verifier', codeVerifier);
        const scope = 'user-read-private user-read-email streaming user-modify-playback-state user-read-playback-state';
        const args = new URLSearchParams({
            response_type: 'code', client_id: clientId, scope, redirect_uri: redirectUri,
            code_challenge_method: 'S256', code_challenge: codeChallenge,
        });
        window.location = 'https://accounts.spotify.com/authorize?' + args;
    };

    const addNextSongToQueue = useCallback(async () => {
        try {
            const currentLists = songListsRef.current;
            const listOrder = ['list-1', 'list-2', 'list-3'];

            let foundSong = false;
            let attempts = 0;

            // Buscar siguiente canción en Round Robin
            while (!foundSong && attempts < 3) {
                const currentIndex = nextListIndex.current;
                const listId = listOrder[currentIndex];
                const list = currentLists[listId];

                console.log(`🔍 Turno de: ${listId} (índice ${currentIndex}).`);

                if (list && list.length > 0 && list[0]) {
                    const nextSong = list[0];

                    // Usar URI como identificador único para evitar duplicados reales en Spotify
                    if (!queuedSongs.current.has(nextSong.uri)) {
                        console.log(`✅ Agregando a cola: ${nextSong.name} de ${listId}`);
                        await fetchWebApi(`v1/me/player/queue?uri=${encodeURIComponent(nextSong.uri)}`, 'POST');

                        // Marcar como encolada usando URI
                        queuedSongs.current.add(nextSong.uri);
                        foundSong = true;
                    } else {
                        console.log(`⚠️ ${nextSong.name} ya está en la cola de Spotify. Saltando.`);
                        // Saltar a la siguiente lista si esta canción ya está encolada
                    }
                } else {
                    console.log(`⚠️ ${listId} vacía.`);
                }

                // Avanzar turno SIEMPRE (para mantener el round robin)
                nextListIndex.current = (currentIndex + 1) % 3;
                attempts++;
            }

            if (!foundSong) console.log('⚠️ Todas las canciones ya están encoladas o listas vacías.');

        } catch (error) {
            console.error('❌ Error agregando a cola:', error);
        }
    }, [fetchWebApi]);

    // Actualizar referencia de la función para el tracker
    useEffect(() => {
        regenerateQueueRef.current = addNextSongToQueue;
    }, [addNextSongToQueue]);

    const startPlaybackTracker = useCallback(() => {
        if (playbackIntervalId.current) clearInterval(playbackIntervalId.current);

        const track = async () => {
            try {
                const state = await fetchWebApi('v1/me/player', 'GET');
                if (!state || !state.is_playing) return;

                const currentTrackUri = state.item.uri;
                setNowPlaying({ name: state.item.name, artist: state.item.artists.map(a => a.name).join(', ') });

                // Si cambió la canción
                if (lastTrackUri.current && currentTrackUri !== lastTrackUri.current) {
                    console.log("🎵 Cambio de canción detectado.");

                    // 1. Eliminar la canción que acaba de empezar de las listas locales
                    setSongLists(lists => {
                        let changed = false;
                        const newLists = JSON.parse(JSON.stringify(lists));

                        for (const listId in newLists) {
                            const index = newLists[listId].findIndex(t => t.uri === currentTrackUri);
                            if (index > -1) {
                                // Eliminar del Set de encoladas también (usando URI)
                                queuedSongs.current.delete(currentTrackUri);

                                newLists[listId].splice(index, 1);
                                changed = true;
                                console.log(`🗑️ Eliminada ${state.item.name} de ${listId}`);
                                break; // Solo eliminamos una instancia
                            }
                        }
                        return changed ? newLists : lists;
                    });

                    // 2. Agregar la SIGUIENTE a la cola (para mantener el buffer)
                    if (regenerateQueueRef.current) {
                        setTimeout(() => regenerateQueueRef.current(), 1000);
                    }
                }

                lastTrackUri.current = currentTrackUri;

            } catch (error) {
                console.error("Error rastreando:", error);
            }
        };

        track();
        playbackIntervalId.current = setInterval(track, 3000);
    }, [fetchWebApi]);

    // Detener tracker al desmontar
    useEffect(() => {
        return () => {
            if (playbackIntervalId.current) clearInterval(playbackIntervalId.current);
        };
    }, []);

    // Reconexión inicial
    useEffect(() => {
        if (!accessToken) return;
        const reconnect = async () => {
            try {
                const state = await fetchWebApi('v1/me/player', 'GET');
                if (state && state.is_playing && state.item) {
                    isPlayingFromApp.current = true;
                    lastTrackUri.current = state.item.uri;
                    startPlaybackTracker();
                }
            } catch (error) {
                console.warn("No se pudo reconectar.", error);
            }
        };
        reconnect();
    }, [accessToken, fetchWebApi, startPlaybackTracker]);

    const handleSearch = useCallback(async (query) => {
        setSearchQuery(query);
        if (!query) {
            setSearchResults([]);
            return;
        }
        try {
            const data = await fetchWebApi(`v1/search?q=${encodeURIComponent(query)}&type=track&limit=5`, 'GET');
            if (data && data.tracks) setSearchResults(data.tracks.items);
        } catch (e) {
            console.error(e);
        }
    }, [fetchWebApi]);

    const addSongToList = async (track) => {
        const listNumber = prompt(`¿A qué lista quieres agregar "${track.name}"?\n(1, 2, o 3)`);
        if (['1', '2', '3'].includes(listNumber)) {
            const listId = `list-${listNumber}`;

            if (songLists[listId].some(t => t.id === track.id)) {
                alert('Esa canción ya está en la lista.');
                setSearchQuery('');
                setSearchResults([]);
                return;
            }

            const newTrack = { id: track.id, name: track.name, artist: track.artists[0].name, uri: track.uri };
            setSongLists(prev => ({
                ...prev,
                [listId]: [...prev[listId], newTrack]
            }));
        }
        setSearchQuery('');
        setSearchResults([]);
    };

    const handlePlayMix = async () => {
        const listOrder = ['list-1', 'list-2', 'list-3'];
        let firstSong = null;
        let startIndex = 0;
        let startListId = null;

        // Buscar primera canción
        for (let i = 0; i < 3; i++) {
            const listId = listOrder[i];
            if (songLists[listId] && songLists[listId].length > 0) {
                firstSong = songLists[listId][0];
                startIndex = i;
                startListId = listId;
                break;
            }
        }

        if (!firstSong) { alert("No hay canciones para reproducir."); return; }

        try {
            // 1. Reproducir
            await fetchWebApi('v1/me/player/play', 'PUT', { uris: [firstSong.uri] });
            isPlayingFromApp.current = true;
            lastTrackUri.current = firstSong.uri;

            // 2. Eliminar la canción inicial de la lista local
            setSongLists(prev => {
                const newLists = { ...prev };
                if (newLists[startListId].length > 0 && newLists[startListId][0].uri === firstSong.uri) {
                    newLists[startListId] = newLists[startListId].slice(1);
                }
                return newLists;
            });

            // 3. Configurar turno para la SIGUIENTE lista
            nextListIndex.current = (startIndex + 1) % 3;

            // Limpiar set de encoladas al iniciar nueva mezcla
            queuedSongs.current.clear();

            // 4. Iniciar tracker
            startPlaybackTracker();

            // 5. Encolar la siguiente canción
            setTimeout(async () => {
                await addNextSongToQueue();
            }, 1000);

        } catch (error) {
            console.error("Error al reproducir:", error);
            alert("Error al reproducir. Asegúrate de tener Spotify abierto y activo.");
        }
    };

    const handleSort = useCallback(({ fromListId, toListId, oldIndex, newIndex }) => {
        setSongLists(prev => {
            const newLists = JSON.parse(JSON.stringify(prev));
            const sourceList = newLists[fromListId];
            const destList = newLists[toListId];

            if (!sourceList || !destList) return prev;

            const [movedItem] = sourceList.splice(oldIndex, 1);
            destList.splice(newIndex, 0, movedItem);

            return newLists;
        });
    }, []);

    const handleRemove = useCallback((listId, trackId) => {
        setSongLists(prev => ({
            ...prev,
            [listId]: prev[listId].filter(t => t.id !== trackId)
        }));
    }, []);

    if (!accessToken) {
        return (
            <div className="login-container">
                <h1>Mi Reproductor Spotify</h1>
                <p>Inicia sesión con tu cuenta de Spotify para comenzar.</p>
                <button onClick={redirectToLogin} className="login-button">
                    Iniciar Sesión con Spotify
                </button>
            </div>
        );
    }

    return (
        <div className="app-wrapper">
            <div className="app-container">
                <div className="now-playing-container">
                    <h2>Reproduciendo ahora</h2>
                    <div className="now-playing-details">
                        {nowPlaying ? (
                            <>
                                <p className="now-playing-name">{nowPlaying.name}</p>
                                <p className="now-playing-artist">{nowPlaying.artist}</p>
                            </>
                        ) : (
                            <p>Selecciona una canción para empezar.</p>
                        )}
                    </div>
                </div>

                <div className="search-container">
                    <input type="text" value={searchQuery} placeholder="Buscar una canción para agregar..." onChange={(e) => handleSearch(e.target.value)} />
                    {searchResults.length > 0 && (
                        <div className="search-results">
                            {searchResults.map(track => (
                                <div key={track.id} onClick={() => addSongToList(track)} className="search-result-item">
                                    <p className="song-name">{track.name}</p>
                                    <p className="song-artist">{track.artists[0].name}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="lists-grid">
                    <SongList listId="list-1" songs={songLists['list-1']} onSort={handleSort} onRemove={handleRemove} />
                    <SongList listId="list-2" songs={songLists['list-2']} onSort={handleSort} onRemove={handleRemove} />
                    <SongList listId="list-3" songs={songLists['list-3']} onSort={handleSort} onRemove={handleRemove} />
                </div>

                <div className="play-button-container">
                    <button onClick={handlePlayMix} className="play-button">
                        Reproducir Mezcla
                    </button>
                </div>
            </div>
        </div>
    );
}

export default App;