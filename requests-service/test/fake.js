// Fake outside servers (Emby, TMDB, MusicBrainz, Navidrome, Audiobookshelf) for tests.
const T = (d) => { const x = new Date(Date.now() + d * 864e5); return x.toISOString().slice(0, 10); };
export const routes = {
  'emby.test/Users/u1': { Name: 'Jayden' }, 'emby.test/Users/u2': { Name: 'Sarah' }, 'emby.test/Users/u3': { Name: 'Mike' },
  'emby.test/Items': { Items: [{ Id: 'e1', Name: 'Dune', Type: 'Movie', ProductionYear: 2021, ProviderIds: { Tmdb: '438631' } }, { Id: 's1', Name: 'Severance', Type: 'Series', ProductionYear: 2022, ProviderIds: { Tmdb: '95396' } }], TotalRecordCount: 2 },
  'emby.test/Shows/s1/Episodes': { Items: [1, 2, 3].map((n) => ({ ParentIndexNumber: 1, IndexNumber: n })).concat([1, 2].map((n) => ({ ParentIndexNumber: 2, IndexNumber: n }))) },
  'api.themoviedb.org/3/search/movie': { results: [{ id: 438631, title: 'Dune', release_date: '2021-09-15', poster_path: '/a.jpg' }, { id: 999, title: 'Dune: Part Three', release_date: T(40), poster_path: '/b.jpg' }] },
  'api.themoviedb.org/3/movie/438631': { id: 438631, title: 'Dune', release_date: '2021-09-15', belongs_to_collection: { id: 726871 }, release_dates: { results: [] } },
  'api.themoviedb.org/3/movie/999': { id: 999, title: 'Dune: Part Three', release_date: T(40), status: 'Post Production', release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ type: 3, release_date: T(40) + 'T00:00:00Z' }] }] } },
  'api.themoviedb.org/3/collection/726871': { id: 726871, name: 'Dune Collection', parts: [{ id: 438631, title: 'Dune', release_date: '2021-09-15' }, { id: 999, title: 'Dune: Part Three', release_date: T(40) }] },
  'api.themoviedb.org/3/tv/95396': { id: 95396, name: 'Severance', first_air_date: '2022-02-17', status: 'Returning Series', in_production: true, seasons: [{ season_number: 1, episode_count: 3, air_date: '2022-02-17' }, { season_number: 2, episode_count: 3, air_date: '2025-01-17' }, { season_number: 3, episode_count: 0, air_date: null }], last_episode_to_air: { season_number: 2, episode_number: 3 } },
  'api.themoviedb.org/3/tv/95396/season/1': { episodes: [1, 2, 3].map((n) => ({ episode_number: n, name: 'E' + n, air_date: '2022-02-17' })) },
  'api.themoviedb.org/3/tv/95396/season/2': { episodes: [1, 2, 3].map((n) => ({ episode_number: n, name: 'E' + n, air_date: '2025-01-17' })) },
  'api.themoviedb.org/3/tv/95396/season/3': { episodes: [] },
  'musicbrainz.org/ws/2/artist': { artists: [{ id: 'ar1', name: 'Radiohead', score: 100 }] },
  'musicbrainz.org/ws/2/release-group': { 'release-groups': [{ id: 'rg1', title: 'OK Computer', 'primary-type': 'Album', 'first-release-date': '1997-05-21', 'artist-credit': [{ name: 'Radiohead', artist: { id: 'ar1' } }] }, { id: 'rg2', title: 'In Rainbows', 'primary-type': 'Album', 'first-release-date': '2007-10-10', 'artist-credit': [{ name: 'Radiohead', artist: { id: 'ar1' } }] }, { id: 'rg3', title: 'Live Thing', 'primary-type': 'Album', 'secondary-types': ['Live'], 'artist-credit': [{ name: 'Radiohead' }] }], 'release-group-count': 3 },
  'musicbrainz.org/ws/2/recording': { recordings: [] },
  'musicbrainz.org/ws/2/release-group/rg2': { id: 'rg2', title: 'In Rainbows', 'primary-type': 'Album', 'first-release-date': '2007-10-10', 'artist-credit': [{ name: 'Radiohead', artist: { id: 'ar1' } }] },
  'nd.test/rest/getAlbumList2': { 'subsonic-response': { status: 'ok', albumList2: { album: [{ id: 'nd1', name: 'OK Computer', artist: 'Radiohead' }] } } },
  'nd.test/rest/search3': { 'subsonic-response': { status: 'ok', searchResult3: {} } },
  'abs.test/api/libraries': { libraries: [] },
};
export const flags = { nd2: false };

export function install() {
  globalThis.fetch = async (u) => {
    const url = new URL(u); const key = url.host + url.pathname;
    let body = routes[key];
    if (key === 'nd.test/rest/getAlbumList2' && flags.nd2) body = { 'subsonic-response': { status: 'ok', albumList2: { album: [{ id: 'nd1', name: 'OK Computer', artist: 'Radiohead' }, { id: 'nd2', name: 'In Rainbows', artist: 'Radiohead' }] } } };
    if (!body) return new Response('nope', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  };
}
export function env() {
  Object.assign(process.env, { EMBY_URL: 'http://emby.test', EMBY_API_KEY: 'k', TMDB_API_KEY: 'x'.repeat(32), NAVIDROME_URL: 'http://nd.test', NAVIDROME_USER: 'u', NAVIDROME_PASSWORD: 'p', ABS_URL: 'http://abs.test', ABS_TOKEN: 't', ADMINS: 'Jayden' });
}
