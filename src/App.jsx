import { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'weather-aggregator-cache-v1';
const CACHE_MS = 1000 * 60 * 30; // 30分キャッシュ

function normalizeWeatherCode(code) {
  const map = {
    0: '晴れ',
    1: '晴れ',
    2: '晴れ',
    3: '曇り',
    45: '霧',
    48: '霧',
    51: '霧雨',
    53: '霧雨',
    55: '霧雨',
    56: '凍霧雨',
    57: '凍霧雨',
    61: '雨',
    63: '雨',
    65: '雨',
    66: '凍雨',
    67: '凍雨',
    71: '雪',
    73: '雪',
    75: '雪',
    77: '雪',
    80: 'にわか雨',
    81: '雨',
    82: '大雨',
    85: '雪',
    86: '大雪',
    95: '雷雨',
    96: '雷雨',
    99: '雷雨'
  };

  return map[code] || '不明';
}

function average(values) {
  const valid = values.filter((v) => Number.isFinite(v));
  if (!valid.length) return 0;
  return valid.reduce((sum, n) => sum + n, 0) / valid.length;
}

function voteWeather(labels) {
  const counts = {};
  labels.forEach((label) => {
    counts[label] = (counts[label] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '不明';
}

async function geocodeLocation(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { 'Accept-Language': 'ja' } });
  if (!response.ok) throw new Error('地域を取得できませんでした。');
  const data = await response.json();
  if (!data.length) throw new Error('該当する地域が見つかりませんでした。');

  return {
    label: data[0].display_name,
    latitude: Number(data[0].lat),
    longitude: Number(data[0].lon)
  };
}

async function fetchWeatherFromOpenMeteo(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('天気データの取得に失敗しました。');
  const data = await response.json();

  const current = {
    temp: data.current?.temperature_2m ?? 0,
    humidity: data.current?.relative_humidity_2m ?? 0,
    feelsLike: data.current?.apparent_temperature ?? 0,
    windSpeed: data.current?.wind_speed_10m ?? 0,
    weather: normalizeWeatherCode(data.current?.weather_code),
    source: 'Open-Meteo'
  };

  const daily = (data.daily?.time || []).map((date, index) => ({
    date,
    maxTemp: data.daily.temperature_2m_max?.[index] ?? 0,
    minTemp: data.daily.temperature_2m_min?.[index] ?? 0,
    precipitationProbability: data.daily.precipitation_probability_max?.[index] ?? 0,
    weather: normalizeWeatherCode(data.daily.weather_code?.[index]),
    source: 'Open-Meteo'
  }));

  return { current, daily };
}

function buildAggregatedForecast(sources) {
  if (!sources.length) return null;

  // 各ソースの天気予報をそのまま保持
  const weatherSources = sources.map(s => ({
    ...s,
    current: {
      ...s.current,
      temp: average([s.current.temp]),
      humidity: average([s.current.humidity]),
      feelsLike: average([s.current.feelsLike]),
      windSpeed: average([s.current.windSpeed])
    }
  }));

  // 多数決で天気を決定
  const currentWeatherVotes = weatherSources.map((item) => item.current.weather);
  const aggregatedCurrentWeather = voteWeather(currentWeatherVotes);

  const current = {
    temp: average(sources.map((item) => item.current.temp)),
    humidity: average(sources.map((item) => item.current.humidity)),
    feelsLike: average(sources.map((item) => item.current.feelsLike)),
    windSpeed: average(sources.map((item) => item.current.windSpeed)),
    weather: aggregatedCurrentWeather,
    sources: weatherSources.map(s => ({
      source: s.current.source,
      weather: s.current.weather,
      temp: s.current.temp
    }))
  };

  const dayCount = Math.max(...sources.map((item) => item.daily.length));
  const daily = [];

  for (let index = 0; index < dayCount; index += 1) {
    const dayEntries = sources
      .map((item) => item.daily[index])
      .filter(Boolean);

    if (!dayEntries.length) continue;

    const dayWeatherVotes = dayEntries.map((entry) => entry.weather);
    const aggregatedDayWeather = voteWeather(dayWeatherVotes);

    daily.push({
      date: dayEntries[0].date,
      maxTemp: average(dayEntries.map((entry) => entry.maxTemp)),
      minTemp: average(dayEntries.map((entry) => entry.minTemp)),
      precipitationProbability: average(dayEntries.map((entry) => entry.precipitationProbability)),
      weather: aggregatedDayWeather,
      sources: dayEntries.map(e => ({
        source: e.source,
        weather: e.weather
      }))
    });
  }

  return { current, daily };
}

function formatDateLabel(dateString) {
  const date = new Date(dateString);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const week = ['日', '月', '火', '水', '木', '金', '土'];
  return `${month}/${day} (${week[date.getDay()]})`;
}

function App() {
  const [query, setQuery] = useState('東京');
  const [label, setLabel] = useState('東京');
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const today = useMemo(() => forecast?.daily?.[0], [forecast]);
  const tomorrow = useMemo(() => forecast?.daily?.[1], [forecast]);

  useEffect(() => {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed?.query && parsed?.forecast && Date.now() - parsed.fetchedAt < CACHE_MS) {
          setQuery(parsed.query);
          setLabel(parsed.label || parsed.query);
          setForecast(parsed.forecast);
        }
      } catch {
        // ignore cache parse errors
      }
    }

    loadWeather('東京');
  }, []);

  async function loadWeather(city) {
    setLoading(true);
    setError('');

    try {
      const loc = await geocodeLocation(city);
      const weather = await fetchWeatherFromOpenMeteo(loc.latitude, loc.longitude);
      const aggregated = buildAggregatedForecast([weather]);

      const payload = {
        query: city,
        label: loc.label,
        forecast: aggregated,
        fetchedAt: Date.now()
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      setLabel(loc.label);
      setForecast(aggregated);
    } catch (err) {
      setError(err.message || '予報の取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  }

  const handleSubmit = (event) => {
    event.preventDefault();
    loadWeather(query.trim() || '東京');
  };

  return (
    <div className="app-shell">
      <div className="container">
        <header className="header">
          <p className="eyebrow">完全無料</p>
          <h1>総合天気予報</h1>
        </header>

        <form onSubmit={handleSubmit} className="searchbar">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="例: 東京, 大阪, 福岡"
            aria-label="地域検索"
          />
          <button type="submit" disabled={loading}>
            {loading ? '取得中...' : '予報を取得'}
          </button>
        </form>

        {error && <div className="error-box">{error}</div>}

        {forecast && (
          <>
            <section className="location-box">
              <span>📍 {label}</span>
            </section>

            <section className="cards">
              <article className="panel highlight">
                <div className="panel-header">
                  <span>今日</span>
                  <span className="chip">総合予報</span>
                </div>
                <div className="main-temp">
                  <strong>{Math.round(forecast.current.temp)}°C</strong>
                  <span>{forecast.current.weather}</span>
                </div>
                <ul className="stat-list">
                  <li>体感: {Math.round(forecast.current.feelsLike)}°C</li>
                  <li>湿度: {Math.round(forecast.current.humidity)}%</li>
                  <li>風速: {Math.round(forecast.current.windSpeed)} km/h</li>
                </ul>
                {forecast.current.sources && forecast.current.sources.length > 0 && (
                  <div className="sources-small">
                    <p className="sources-label">各ソース:</p>
                    {forecast.current.sources.map((src, idx) => (
                      <div key={idx} className="source-item">
                        <span className="source-name">{src.source}</span>
                        <span className="source-weather">{src.weather}</span>
                        <span className="source-temp">{Math.round(src.temp)}°C</span>
                      </div>
                    ))}
                  </div>
                )}
              </article>

              <article className="panel">
                <div className="panel-header">
                  <span>明日</span>
                  <span className="chip muted">次の日</span>
                </div>
                <div className="main-temp small">
                  <strong>{Math.round(tomorrow?.maxTemp || 0)}°C</strong>
                  <span>{tomorrow?.weather || '不明'}</span>
                </div>
                <ul className="stat-list">
                  <li>最高: {Math.round(tomorrow?.maxTemp || 0)}°C</li>
                  <li>最低: {Math.round(tomorrow?.minTemp || 0)}°C</li>
                  <li>降水: {Math.round(tomorrow?.precipitationProbability || 0)}%</li>
                </ul>
                {tomorrow?.sources && tomorrow.sources.length > 0 && (
                  <div className="sources-small">
                    <p className="sources-label">各ソース:</p>
                    {tomorrow.sources.map((src, idx) => (
                      <div key={idx} className="source-item">
                        <span className="source-name">{src.source}</span>
                        <span className="source-weather">{src.weather}</span>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            </section>

            <section className="week-panel">
              <h2>7日間の予報</h2>
              <div className="week-grid">
                {forecast.daily.slice(0, 7).map((day, index) => (
                  <div key={`${day.date}-${index}`} className="day-card">
                    <div className="day-label">{formatDateLabel(day.date)}</div>
                    <div className="day-weather">{day.weather}</div>
                    <div className="temp-line">
                      <span>{Math.round(day.maxTemp)}°</span>
                      <span className="low">{Math.round(day.minTemp)}°</span>
                    </div>
                    <div className="rain">降水 {Math.round(day.precipitationProbability)}%</div>
                    {day.sources && day.sources.length > 0 && (
                      <div className="day-sources">
                        {day.sources.map((src, idx) => (
                          <div key={idx} className="day-source-item">
                            <span className="day-source-weather">{src.weather}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
