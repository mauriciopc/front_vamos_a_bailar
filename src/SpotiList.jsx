import React, { useState, useEffect, useCallback, useRef } from 'react';
import './SpotiList.css';

// --- CONFIGURACIÓN ---
const clientId = "fb8cef2d33f04f929c1f1361aa9a30d9";
const redirectUri = window.location.origin + window.location.pathname;

// --- Helpers ---
const getRoundRobinQueue = (lists) => {
    const list1 = lists['list-1'] || [];
    const list2 = lists['list-2'] || [];
    const list3 = lists['list-3'] || [];
    const maxLength = Math.max(list1.length, list2.length, list3.length);
    const mixedQueue = [];
    for (let i = 0; i < maxLength; i++) {
        if (list1[i]) mixedQueue.push(list1[i].uri);
        if (list2[i]) mixedQueue.push(list2[i].uri);
        if (list3[i]) mixedQueue.push(list3[i].uri);
    }
    return mixedQueue;
};

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
const SongList = ({ listId, songs, onSort, onRemove }) => {
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

    const listKey = songs.map(s => s.id).join(',');

    return (
        <div className="list-container">
            <h3>{listTitle}</h3>
            <div id={listId} ref={sortableRef} className="song-list" key={listKey}>
                {songs.map(track => (
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

    const playbackIntervalId = useRef(null);
    const lastTrackUri = useRef(null);
    const isPlayingFromApp = useRef(false);
    const regenerateQueueRef = useRef(null);

    const fetchWebApi = useCallback(async (endpoint, method, body) => {
        const currentToken = await getValidToken();
        if (!currentToken) {
            setAccessToken(null);
            return;
        }
        const res = await fetch(`https://api.spotify.com/${endpoint}`, {
            headers: { 'Authorization': `Bearer ${currentToken}` },
            method,
            body: JSON.stringify(body)
        });
        if (res.ok) {
            return res.status === 204 ? null : await res.json();
        } else {
            const errorText = await res.text();
            console.error('Error con la API de Spotify:', res.status, errorText);
            if (res.status === 401) {
                setAccessToken(null);
                localStorage.clear();
            }
            throw new Error('Spotify API Error');
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

    useEffect(() => {
        const savedLists = localStorage.getItem('spotify_song_lists');
        if (savedLists) {
            setSongLists(JSON.parse(savedLists));
        }
        const handleAuth = async () => {
            const params = new URLSearchParams(window.location.search);
            const code = params.get('code');
            if (code) {
                const codeVerifier = localStorage.getItem('code_verifier');
                try {
                    const response = await fetch('https://accounts.spotify.com/api/token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({
                            client_id: clientId, grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier,
                        }),
                    });
                    if (!response.ok) throw new Error('HTTP status ' + response.status);
                    const data = await response.json();
                    const expiryTime = Date.now() + data.expires_in * 1000;
                    localStorage.setItem('spotify_access_token', data.access_token);
                    localStorage.setItem('spotify_token_expiry', expiryTime.toString());
                    localStorage.setItem('spotify_refresh_token', data.refresh_token);
                    setAccessToken(data.access_token);
                    window.history.pushState({}, '', redirectUri);
                } catch (error) {
                    console.error('Error al obtener token inicial:', error);
                }
            } else {
                const token = await getValidToken();
                if (token) setAccessToken(token);
            }
        };
        handleAuth();
    }, [getValidToken]);

    const stopPlaybackTracker = useCallback(() => {
        clearInterval(playbackIntervalId.current);
        playbackIntervalId.current = null;
        isPlayingFromApp.current = false;
        lastTrackUri.current = null;
    }, []);

    const regenerateQueue = useCallback(async (newLists) => {
        try {
            console.log('🔍 Verificando estado de reproducción...');
            const state = await fetchWebApi('v1/me/player', 'GET');

            if (!state || !state.is_playing || !state.item) {
                console.log('⏸️ No se está reproduciendo nada, no se regenera la cola.');
                return;
            }

            const currentTrackUri = state.item.uri;
            const progressMs = state.progress_ms;

            const fullQueue = getRoundRobinQueue(newLists);
            console.log('🎵 Cola calculada (Round Robin):', fullQueue.length, 'canciones');
            console.log('🎧 Canción actual:', currentTrackUri);

            if (fullQueue.length === 0) {
                console.log('⚠️ No hay canciones en las listas para agregar a la cola.');
                return;
            }

            const currentIndex = fullQueue.findIndex(uri => uri === currentTrackUri);
            console.log('📍 Índice de canción actual en cola:', currentIndex);

            if (currentIndex !== -1) {
                const newQueue = fullQueue.slice(currentIndex);
                console.log('📋 Actualizando cola desde canción actual:', newQueue.length, 'canciones');

                await fetchWebApi('v1/me/player/play', 'PUT', {
                    uris: newQueue,
                    position_ms: progressMs
                });
                console.log('✅ Cola actualizada - Canción actual encontrada en las listas');
            } else {
                const newQueue = [currentTrackUri, ...fullQueue];
                console.log('📋 Canción actual no está en listas. Cola:', newQueue.length, 'canciones');

                await fetchWebApi('v1/me/player/play', 'PUT', {
                    uris: newQueue,
                    position_ms: progressMs
                });
                console.log('✅ Cola actualizada - Canción actual + listas agregadas después');
            }
        } catch (error) {
            console.error('❌ Error regenerando la cola:', error);
        }
    }, [fetchWebApi]);

    // Guardamos la referencia actualizada
    useEffect(() => {
        regenerateQueueRef.current = regenerateQueue;
    }, [regenerateQueue]);

    const startPlaybackTracker = useCallback(() => {
        stopPlaybackTracker();
        const track = async () => {
            try {
                const state = await fetchWebApi('v1/me/player', 'GET');
                if (!state || !state.is_playing) { stopPlaybackTracker(); return; }

                const currentTrackUri = state.item.uri;
                setNowPlaying({ name: state.item.name, artist: state.item.artists.map(a => a.name).join(', ') });

                // Si la canción cambió (nueva canción empezó), eliminamos la ACTUAL inmediatamente
                if (lastTrackUri.current && currentTrackUri !== lastTrackUri.current) {
                    let updatedLists = null;

                    setSongLists(lists => {
                        let changed = false;
                        const newLists = JSON.parse(JSON.stringify(lists));

                        // Eliminamos la canción ACTUAL (la que acaba de empezar)
                        for (const listId in newLists) {
                            const index = newLists[listId].findIndex(t => t.uri === currentTrackUri);
                            if (index > -1) {
                                newLists[listId].splice(index, 1);
                                changed = true;
                                updatedLists = newLists;
                                console.log(`🗑️ Canción eliminada inmediatamente de ${listId}`);
                                break;
                            }
                        }
                        return changed ? newLists : lists;
                    });

                    // Si eliminamos una canción, regeneramos la cola
                    if (updatedLists && regenerateQueueRef.current) {
                        try {
                            await regenerateQueueRef.current(updatedLists);
                        } catch (error) {
                            console.error('Error regenerando cola después de eliminar canción:', error);
                        }
                    }
                }

                lastTrackUri.current = currentTrackUri;

            } catch (error) {
                console.error("Error rastreando:", error);
                stopPlaybackTracker();
            }
        };
        track();
        playbackIntervalId.current = setInterval(track, 3000);
    }, [fetchWebApi, stopPlaybackTracker]);

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

    // Guardar listas en local Storage cuando cambien
    useEffect(() => {
        localStorage.setItem('spotify_song_lists', JSON.stringify(songLists));
    }, [songLists]);

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

            console.log('🎵 Intentando agregar canción:', track.name);

            // Verificar si la canción ya existe en la lista
            if (songLists[listId].some(t => t.id === track.id)) {
                alert('Esa canción ya está en la lista.');
                setSearchQuery('');
                setSearchResults([]);
                return;
            }

            // Calcular las listas actualizadas ANTES de setSongLists
            const newTrack = { id: track.id, name: track.name, artist: track.artists[0].name, uri: track.uri };
            const updatedLists = {
                ...songLists,
                [listId]: [...songLists[listId], newTrack]
            };

            console.log('📝 Canción agregada a la lista local');

            // Actualizar estado local
            setSongLists(updatedLists);

            // Actualizar la cola de Spotify
            console.log('🔄 Iniciando actualización de cola en Spotify...');

            try {
                await regenerateQueue(updatedLists);
                console.log('✅ Proceso de actualización completado');
            } catch (e) {
                console.error("❌ Error al actualizar cola de Spotify:", e);
            }
        }
        setSearchQuery('');
        setSearchResults([]);
    };

    const handlePlayMix = async () => {
        const mixedQueue = getRoundRobinQueue(songLists);
        if (mixedQueue.length === 0) { alert("No hay canciones para reproducir."); return; }
        try {
            await fetchWebApi('v1/me/player/play', 'PUT', { uris: mixedQueue });
            isPlayingFromApp.current = true;

            if (mixedQueue.length > 0) {
                lastTrackUri.current = mixedQueue[0];
            }

            startPlaybackTracker();
        } catch (error) {
            console.error("Error al reproducir:", error);
            alert("Error al reproducir. Asegúrate de tener Spotify abierto y activo.");
        }
    };

    const handleSort = async ({ fromListId, toListId, oldIndex, newIndex }) => {
        const currentLists = songLists;
        if (!currentLists[fromListId] || !currentLists[toListId]) return;

        const newLists = JSON.parse(JSON.stringify(currentLists));
        const sourceList = newLists[fromListId];
        const destList = newLists[toListId];

        if (!sourceList || !destList) return;
        if (oldIndex < 0 || oldIndex >= sourceList.length) return;

        const [movedItem] = sourceList.splice(oldIndex, 1);
        destList.splice(newIndex, 0, movedItem);

        setSongLists(newLists);

        // Regenerar la cola
        try {
            await regenerateQueue(newLists);
            console.log('✅ Orden actualizado y cola sincronizada');
        } catch (e) {
            console.error("Error al regenerar la cola después de ordenar:", e);
        }
    };

    const handleRemove = useCallback((listId, trackId) => {
        setSongLists(currentLists => {
            const newList = currentLists[listId].filter(t => t.id !== trackId);
            return { ...currentLists, [listId]: newList };
        });
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