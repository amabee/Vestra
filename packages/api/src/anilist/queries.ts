/** AniList GraphQL documents. Kept as plain strings — no codegen step required. */

const MEDIA_FIELDS = `
  id
  title { romaji english native }
  description(asHtml: false)
  coverImage { extraLarge large medium color }
  bannerImage
  averageScore
  popularity
  genres
  episodes
  duration
  status
  format
  seasonYear
  siteUrl
  isAdult
`;

export const SEARCH_ANIME_QUERY = `
  query SearchAnime($search: String!, $page: Int = 1, $perPage: Int = 20, $isAdult: Boolean = false) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { total currentPage lastPage hasNextPage }
      media(search: $search, type: ANIME, sort: SEARCH_MATCH, isAdult: $isAdult) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

export const TRENDING_ANIME_QUERY = `
  query TrendingAnime($page: Int = 1, $perPage: Int = 20) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { total currentPage lastPage hasNextPage }
      media(type: ANIME, sort: TRENDING_DESC, isAdult: false) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

export const POPULAR_ANIME_QUERY = `
  query PopularAnime($page: Int = 1, $perPage: Int = 20) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { total currentPage lastPage hasNextPage }
      media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

export const ANIME_DETAILS_QUERY = `
  query AnimeDetails($id: Int!) {
    Media(id: $id, type: ANIME) {
      ${MEDIA_FIELDS}
      studios(isMain: true) { nodes { name } }
      countryOfOrigin
      characters(sort: ROLE, perPage: 20) {
        edges {
          role
          node { id name { full } image { medium } }
        }
      }
      relations {
        edges {
          relationType
          node { ${MEDIA_FIELDS} type }
        }
      }
      streamingEpisodes { title thumbnail url site }
    }
  }
`;
