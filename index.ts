import parseScheduleHtml, { LiveInfo } from 'holo-schedule';
import getScheduleHtml from 'holo-schedule/lib/getScheduleHtml';
import { writeFile } from 'fs';
import axios from 'axios';

interface Snippet {
  publishedAt: string;
  channelId: string;
  title: string;
  description: string;
  channelTitle: string;
}

type SnippetDict = Record<string, Snippet>

type ExtendLiveInfo = LiveInfo & Partial<Snippet>

const MAP_URL = 'https://holonow.github.io/holo-data/imageMap.json';
const OLD_LIVES_URL = 'https://holonow.github.io/holo-data/schedule.json';

function write(path: string, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    writeFile(path, data, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function recentLives(lives: LiveInfo[]): LiveInfo[] {
  const now = Date.now();
  const dayLater = now + 24 * 60 * 60 * 1000;

  return lives.filter((live) => {
    const timeVal = live.time.valueOf();
    return timeVal >= now && timeVal <= dayLater;
  });
}

async function getLiveDetails(lives: LiveInfo[]): Promise<SnippetDict> {
  const ids = recentLives(lives).map((live) => live.videoId);
  const params = {
    id: ids.join(','),
    part: 'id,snippet',
    key: process.env.YT_API_KEY,
  };

  const VIDEOS_API_URL = 'https://www.googleapis.com/youtube/v3/videos';
  const { data } = await axios.get(VIDEOS_API_URL, { params });

  const { items } = data;
  const dict: SnippetDict = {};
  items.forEach(({ id, snippet }) => {
    dict[id] = snippet;
  });

  return dict;
}

async function fetchMap() {
  try {
    const res = await axios.get(MAP_URL);
    return res.data;
  } catch {
    return undefined;
  }
}

async function fetchLives() {
  try {
    const res = await axios.get(OLD_LIVES_URL);
    return res.data;
  } catch {
    return [];
  }
}

async function fetchRemoteData() {
  const [imgMap, oldLives, html] = await Promise.all([
    fetchMap(),
    fetchLives(),
    getScheduleHtml(),
  ]);

  return { imgMap, oldLives, html };
}

function getOldLiveInfos(oldLives: ExtendLiveInfo[]): Record<string, ExtendLiveInfo> {
  const dict: Record<string, ExtendLiveInfo> = {};
  oldLives.forEach((live) => {
    const { title, videoId } = live;
    if (title) {
      dict[videoId] = live;
    }
  });
  return dict;
}

function pickInfo(info: Partial<Snippet>) {
  const { title } = info;
  return { title };
}

async function livesWithYouTubeInfo(
  lives: LiveInfo[],
  oldLives: ExtendLiveInfo[],
): Promise<ExtendLiveInfo[]> {
  const liveYtInfos = await getLiveDetails(lives);
  const oldInfos = getOldLiveInfos(oldLives);

  const extendedLives = lives.map((live) => {
    const { videoId } = live;
    const ytInfo = liveYtInfos[videoId] || {};
    const oldInfo = oldInfos[videoId] || {};

    const picked = pickInfo({ ...oldInfo, ...ytInfo });

    return {
      ...picked,
      ...live,
    };
  });

  return extendedLives;
}

async function main() {
  const { imgMap, oldLives, html } = await fetchRemoteData();

  const { lives, dict } = parseScheduleHtml(html, imgMap);

  getLiveDetails(lives);
  const extendedLives = await livesWithYouTubeInfo(lives, oldLives);

  return Promise.all([
    write('build/schedule.json', JSON.stringify(extendedLives)),
    write('build/imageMap.json', JSON.stringify(dict)),
  ]);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);

  process.exit(1);
});
