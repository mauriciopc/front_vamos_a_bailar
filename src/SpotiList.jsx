import React, { useState, useEffect, useCallback, useRef } from 'react';
import './SpotiList.css';

// --- CONFIGURACIÓN ---
// ¡IMPORTANTE! Reemplaza esto con tu Client ID de Spotify.
const clientId = "fb8cef2d33f04f929c1f1361aa9a30d9";
const redirectUri = window.location.origin + window.location.pathname;

// --- Componente SongItem (para la lista) ---
const SongItem = ({ track, listId, onRemove }) => (
    <div className="song-item" data-track-id={track.id}>
        <div className="song-info">
            <p className="song-name">{track.name}</p>
            <p className="song-artist">{track.artist}</p>
        </div>
        <button onClick={() => onRemove(listId, track.id)} className="remove-button">&times;</button>
    </div>
);

// --- Componente SongList (Columna de la lista) ---
const SongList = ({ listId, songs, onSort, onRemove }) => {
    const listTitle = `Lista ${listId.split('-')[1]}`;
    const sortableRef = useRef(null);

    useEffect(() => {
        if (window.Sortable && sortableRef.current) {
            new window.Sortable(sortableRef.current, {
                group: 'shared',
                animation: 150,
                ghostClass: 'song-item-ghost',
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
        }
    }, [onSort]);

    return (
        <div className="list-container">
            <h3>{listTitle}</h3>
            <div id={listId} ref={sortableRef} className="song-list">
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


// --- Componente Principal de la App ---
function App() {
    const [accessToken, setAccessToken] = useState(localStorage.getItem('spotify_access_token'));
    const [songLists, setSongLists] = useState({ 'list-1': [], 'list-2': [], 'list-3': [] });
    const [searchResults, setSearchResults] = useState([]);
    const [nowPlaying, setNowPlaying] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');

    const playbackIntervalId = useRef(null);
    const updateQueueTimeout = useRef(null);
    const lastTrackUri = useRef(null);
    const isPlayingFromApp = useRef(false);

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

    const startPlaybackTracker = useCallback(() => {
        stopPlaybackTracker();
        const track = async () => {
            try {
                const state = await fetchWebApi('v1/me/player', 'GET');
                if (!state || !state.is_playing) { stopPlaybackTracker(); return; }
                const currentTrackUri = state.item.uri;
                if (currentTrackUri !== lastTrackUri.current) {
                    setNowPlaying({ name: state.item.name, artist: state.item.artists.map(a => a.name).join(', ') });
                    setSongLists(lists => {
                        let changed = false;
                        const newLists = JSON.parse(JSON.stringify(lists));
                        for (const listId in newLists) {
                            const index = newLists[listId].findIndex(t => t.uri === currentTrackUri);
                            if (index > -1) {
                                newLists[listId].splice(index, 1);
                                changed = true;
                                break;
                            }
                        }
                        return changed ? newLists : lists;
                    });
                    lastTrackUri.current = currentTrackUri;
                }
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
                    startPlaybackTracker();
                }
            } catch (error) {
                console.warn("No se pudo reconectar.", error);
            }
        };
        reconnect();
    }, [accessToken, fetchWebApi, startPlaybackTracker]);

    const updateQueue = useCallback(() => {
        if (!isPlayingFromApp.current) return;
        clearTimeout(updateQueueTimeout.current);
        updateQueueTimeout.current = setTimeout(async () => {
            try {
                const state = await fetchWebApi('v1/me/player', 'GET');
                if (!state || !state.item) { stopPlaybackTracker(); return; }
                const list1 = songLists['list-1'] || [];
                const list2 = songLists['list-2'] || [];
                const list3 = songLists['list-3'] || [];
                const maxLength = Math.max(list1.length, list2.length, list3.length);
                const newQueue = [];
                for (let i = 0; i < maxLength; i++) {
                    if (list1[i]) newQueue.push(list1[i].uri);
                    if (list2[i]) newQueue.push(list2[i].uri);
                    if (list3[i]) newQueue.push(list3[i].uri);
                }
                if (newQueue.length === 0) return;
                const finalQueue = [state.item.uri, ...newQueue];
                await fetchWebApi('v1/me/player/play', 'PUT', { uris: finalQueue, offset: { position: 0 }, position_ms: state.progress_ms });
            } catch (error) {
                console.error("Error al actualizar la cola:", error);
            }
        }, 1500);
    }, [fetchWebApi, songLists, stopPlaybackTracker]);

    useEffect(() => {
        localStorage.setItem('spotify_song_lists', JSON.stringify(songLists));
        updateQueue();
    }, [songLists, updateQueue]);

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
            console.error(e)
        }
    }, [fetchWebApi]);

    const addSongToList = (track) => {
        const listNumber = prompt(`¿A qué lista quieres agregar "${track.name}"?\n(1, 2, o 3)`);
        if (['1', '2', '3'].includes(listNumber)) {
            const listId = `list-${listNumber}`;
            setSongLists(lists => {
                if (lists[listId].some(t => t.id === track.id)) {
                    alert('Esa canción ya está en la lista.');
                    return lists;
                }
                const newTrack = { id: track.id, name: track.name, artist: track.artists[0].name, uri: track.uri };
                return { ...lists, [listId]: [...lists[listId], newTrack] };
            });
        }
        setSearchQuery('');
        setSearchResults([]);
    };

    const handlePlayMix = async () => {
        const list1 = songLists['list-1'] || [];
        const list2 = songLists['list-2'] || [];
        const list3 = songLists['list-3'] || [];
        const maxLength = Math.max(list1.length, list2.length, list3.length);
        const mixedQueue = [];
        for (let i = 0; i < maxLength; i++) {
            if (list1[i]) mixedQueue.push(list1[i].uri);
            if (list2[i]) mixedQueue.push(list2[i].uri);
            if (list3[i]) mixedQueue.push(list3[i].uri);
        }
        if (mixedQueue.length === 0) { alert("No hay canciones para reproducir."); return; }
        try {
            await fetchWebApi('v1/me/player/play', 'PUT', { uris: mixedQueue });
            isPlayingFromApp.current = true;
            startPlaybackTracker();
        } catch (error) {
            alert("Error al reproducir. Asegúrate de tener Spotify abierto.");
        }
    };

    const handleSort = useCallback(({ fromListId, toListId, oldIndex, newIndex }) => {
        setSongLists(currentLists => {
            const newLists = JSON.parse(JSON.stringify(currentLists));
            const [movedItem] = newLists[fromListId].splice(oldIndex, 1);
            newLists[toListId].splice(newIndex, 0, movedItem);
            return newLists;
        });
    }, []);

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