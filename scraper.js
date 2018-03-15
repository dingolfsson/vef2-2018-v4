require('dotenv').config();

require('es6-promise').polyfill();
require('isomorphic-fetch');

const cheerio = require('cheerio');
const redis = require('redis');
const util = require('util');

const redisOptions = {
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379/0',
};

const client = redis.createClient(redisOptions);

const asyncGet = util.promisify(client.get).bind(client);
const asyncSet = util.promisify(client.set).bind(client);

const cacheTtL = process.env.REDIS_EXPIRE || 7200;
const allExams = 'https://ugla.hi.is/Proftafla/View/ajax.php?sid=2027&a=getProfSvids&proftaflaID=37&svidID=0&notaVinnuToflu=0';

/**
 * Stofnar cache fyrir skod ef tad er ekki til
 * skilar annars cache.
 * @returns {Promise} sem inniheldur json gogn.
 */
async function get(url, cacheKey) {
  const cached = await asyncGet(cacheKey);

  if (cached) {
    return JSON.parse(cached);
  }

  const response = await fetch(url);
  const text = await response.json();

  await asyncSet(cacheKey, JSON.stringify(text), 'EX', cacheTtL);
  // client.quit();
  return text;
}

/**
 * Listi af sviðum með „slug“ fyrir vefþjónustu og viðbættum upplýsingum til
 * að geta sótt gögn.
 */
const departments = [
  {
    name: 'Félagsvísindasvið',
    slug: 'felagsvisindasvid',
    id: 1,
  },
  {
    name: 'Heilbrigðisvísindasvið',
    slug: 'heilbrigdisvisindasvid',
    id: 2,
  },
  {
    name: 'Hugvísindasvið',
    slug: 'hugvisindasvid',
    id: 3,
  },
  {
    name: 'Menntavísindasvið',
    slug: 'menntavisindasvid',
    id: 4,
  },
  {
    name: 'Verkfræði- og náttúruvísindasvið',
    slug: 'verkfraedi-og-natturuvisindasvid',
    id: 5,
  },
];

/**
 * Sækir svið eftir `slug`. Fáum gögn annaðhvort beint frá vef eða úr cache.
 *
 * @param {string} slug - Slug fyrir svið sem skal sækja
 * @returns {Promise} Promise sem mun innihalda gögn fyrir svið eða null ef það finnst ekki
 */
async function getTests(slug) {
  let id = 0;
  for (let i = 0; i < departments.length; i += 1) {
    if (departments[i].slug === slug) {
      id = i + 1;
    }
  }
  const url = `//ugla.hi.is/Proftafla/View/ajax.php?sid=2027&a=getProfSvids&proftaflaID=37&svidID=${id}&notaVinnuToflu=0`;

  const result = await get(url, slug);

  const $ = cheerio.load(result.html);

  const test = $('.table-bordered.table-hover.table-striped.table tbody');
  const heading = $('div.box').find('h3');

  const tests = [];
  const eachTest = [];
  heading.each((i, e) => {
    const header = $(e).text();
    tests.push({ header });
    test.each((j, el) => {
      const td = $(el).find('tr');
      td.each((k, ele) => {
        const number = $(ele).find('td:nth-child(1)').text();
        const name = $(ele).find('td:nth-child(2)').text();
        const type = $(ele).find('td:nth-child(3)').text();
        const students = parseInt($(ele).find('tr > td:nth-child(4)').text(), 10);
        const time = $(ele).find('tr > td:nth-child(5)').text();

        eachTest.push({
          number,
          name,
          type,
          students,
          time,
        });
      });
    });
    tests.push(eachTest);
  });
  // client.quit();
  return tests;
}

/**
 * Hreinsar cache.
 *
 * @returns {Promise} Promise sem mun innihalda boolean um hvort cache hafi verið hreinsað eða ekki.
 */
async function clearCache() {
  return client.flushdb();
}

/**
 * Sækir tölfræði fyrir öll próf allra deilda allra sviða.
 *
 * @returns {Promise} Promise sem mun innihalda object með tölfræði um próf
 */
async function getStats() {
  // Promise.all()....
  const text = await get(allExams, 'all');
  const $ = cheerio.load(text.html);
  const test = $('.table-bordered.table-hover.table-striped.table tbody');
  const stats = [];

  test.each((j, el) => {
    const td = $(el).find('tr');
    td.each((i, ele) => {
      const students = $(ele).find('tr > td:nth-child(4)').text();

      stats.push({
        students: Number(students),
      });
    });
  });

  const sorted = stats.sort((a, b) => a.students - b.students);

  const allStats = [];
  let numStudents = 0;

  for (let i = 0; i < stats.length; i += 1) {
    numStudents += stats[i].students;
  }

  allStats.push({
    min: sorted[0].students,
    max: sorted[sorted.length - 1].students,
    numtests: sorted.length,
    numStudents,
    averageStudents: (numStudents / sorted.length).toFixed(2),
  });

  return allStats;
}

module.exports = {
  departments,
  getTests,
  clearCache,
  getStats,
};
