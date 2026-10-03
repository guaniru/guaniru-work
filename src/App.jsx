import { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'weather-aggregator-cache-v1';
const RECENT_KEY = 'weather-recent-cities-v1';
const CACHE_MS = 1000 * 60 * 30;

function normalizeWeatherLabel(label) {
  const text = String(label || '').toLowerCase();
  if (text.includes('sun') || text.includes('clear') || text.includes('晴')) return '晴れ';
  if (text.includes('cloud') || text.includes('overcast') || text.includes('曇')) return '曇り';
  if (text.includes('rain') || text.includes('shower') || text.includes('drizzle') || text.includes('雨')) return '雨';
  if (text.includes('snow') || text.includes('ice') || text.includes('雪')) return '雪';
  if (text.includes('fog') || text.includes('mist') || text.includes('霧')) return '霧';
  if (text.includes('thunder') || text.includes('storm') || text.includes('雷')) return '雷雨';
  return '不明';
}

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

function getWeatherAdvice(temp, rainChance, weatherLabel) {
  if (temp >= 30) {
    return { outfit: '薄着で快適', umbrella: '日差しが強いので日焼け対策', accent: '熱中症対策' };
  }
  if (temp >= 22) {
    return { outfit: '半袖が快適', umbrella: rainChance > 50 ? '傘があると安心' : '晴れが多い', accent: '過ごしやすい' };
  }
  if (temp >= 15) {
    return { outfit: '長袖がちょうど良い', umbrella: rainChance > 50 ? '雨具を準備' : '風が冷たいので軽い羽織り', accent: '過ごしやすい' };
  }
  if (temp >= 8) {
    return { outfit: '上着が必要', umbrella: weatherLabel.includes('雨') || rainChance > 50 ? '雨具を持って出かける' : '空気が冷えやすい', accent: '朝晩は冷えます' };
  }
  return { outfit: '厚手の服装', umbrella: weatherLabel.includes('雪') || weatherLabel.includes('雨') ? '防寒と雨対策' : '防寒に注意', accent: '寒さが強い' };
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

async function reverseGeocodeLocation(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&accept-language=ja`;
  const response = await fetch(url, { headers: { 'Accept-Language': 'ja' } });
  if (!response.ok) throw new Error('現在地を取得できませんでした。');
  const data = await response.json();
  return data?.address?.city || data?.address?.town || data?.address?.village || '現在地';
}

async function fetchWeatherFromOpenMeteo(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Open-Meteo: 天気データの取得に失敗しました。');
  const data = await response.json();

  const current = {
    temp: data.current?.temperature_2m ?? 0,
    humidity: data.current?.relative_humidity_2m ?? 0,
    feelsLike: data.current?.apparent_temperature ?? 0,
    windSpeed: data.current?.wind_speed_10m ?? 0,
    weather: normalizeWeatherCode(data.current?.weather_code),
    precipitationProbability: data.daily?.precipitation_probability_max?.[0] ?? 0,
    source: 'Open-Meteo'
  };

  const hourly = (data.hourly?.time || []).slice(0, 24).map((time, index) => ({
    time,
    temp: data.hourly.temperature_2m?.[index] ?? 0,
    precipitationProbability: data.hourly.precipitation_probability?.[index] ?? 0,
    weather: normalizeWeatherCode(data.hourly.weather_code?.[index])
  }));

  const daily = (data.daily?.time || []).map((date, index) => ({
    date,
    maxTemp: data.daily.temperature_2m_max?.[index] ?? 0,
    minTemp: data.daily.temperature_2m_min?.[index] ?? 0,
    precipitationProbability: data.daily.precipitation_probability_max?.[index] ?? 0,
    weather: normalizeWeatherCode(data.daily.weather_code?.[index]),
    source: 'Open-Meteo'
  }));

  return { current, daily, hourly };
}

async function fetchWeatherFromWttr(city) {
  const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('wttr.in: 天気データの取得に失敗しました。');

  const data = await response.json();
  const current = data?.current_condition?.[0];
  const weather = data?.weather || [];

  if (!current) throw new Error('wttr.in: 現在の天気データがありません。');

  const weatherLabel = normalizeWeatherLabel(current.weatherDesc?.[0]?.value || '不明');
  const baseDate = new Date();
  baseDate.setMinutes(0, 0, 0);

  const hourly = (weather[0]?.hourly || []).slice(0, 24).map((item, index) => {
    const time = new Date(baseDate.getTime() + index * 60 * 60 * 1000).toISOString();
    return {
      time,
      temp: Number(item.tempC || 0),
      precipitationProbability: Number(item.precipMM || 0),
      weather: normalizeWeatherLabel(item.weatherDesc?.[0]?.value || '不明')
    };
  });

  return {
    current: {
      temp: Number(current.temp_C || 0),
      humidity: Number(current.humidity || 0),
      feelsLike: Number(current.FeelsLikeC || 0),
      windSpeed: Number(current.windspeedKmph || 0),
      weather: weatherLabel,
      precipitationProbability: Number(current.precipMM || 0),
      source: 'wttr.in'
    },
    daily: weather.slice(0, 7).map((day) => ({
      date: day.date,
      maxTemp: Number(day.maxtempC || 0),
      minTemp: Number(day.mintempC || 0),
      precipitationProbability: Number(day.precipMM || 0),
      weather: normalizeWeatherLabel(day.hourly?.[0]?.weatherDesc?.[0]?.value || day.hourly?.[1]?.weatherDesc?.[0]?.value || day.hourly?.[2]?.weatherDesc?.[0]?.value || '不明'),
      source: 'wttr.in'
    })),
    hourly
  };
}

async function fetchAllWeatherSources(city, lat, lon) {
  const results = [];

  const openMeteo = await fetchWeatherFromOpenMeteo(lat, lon).catch(() => null);
  if (openMeteo) results.push(openMeteo);

  const wttr = await fetchWeatherFromWttr(city).catch(() => null);
  if (wttr) results.push(wttr);

  if (results.length === 0) {
    throw new Error('どの無料天気サービスからもデータを取得できませんでした。');
  }

  return results;
}

function buildHourlyForecast(sources) {
  const map = new Map();

  sources.forEach((source) => {
    (source.hourly || []).forEach((point) => {
      if (!point?.time) return;
      if (!map.has(point.time)) {
        map.set(point.time, { temps: [], weather: [], precip: [] });
      }
      const bucket = map.get(point.time);
      if (Number.isFinite(point.temp)) bucket.temps.push(point.temp);
      if (point.weather) bucket.weather.push(point.weather);
      if (Number.isFinite(point.precipitationProbability)) bucket.precip.push(point.precipitationProbability);
    });
  });

  return Array.from(map.entries())
    .map(([time, item]) => ({
      time,
      temp: average(item.temps),
      weather: voteWeather(item.weather),
      precipitationProbability: average(item.precip)
    }))
    .filter((entry) => entry.time)
    .slice(0, 24);
}

function buildAggregatedForecast(sources) {
  if (!sources.length) return null;

  const current = {
    temp: average(sources.map((item) => item.current.temp).filter((t) => t !== 0)),
    humidity: average(sources.map((item) => item.current.humidity).filter((h) => h !== 0)),
    feelsLike: average(sources.map((item) => item.current.feelsLike).filter((f) => f !== 0)),
    windSpeed: average(sources.map((item) => item.current.windSpeed).filter((w) => w !== 0)),
    precipitationProbability: average(sources.map((item) => item.current.precipitationProbability).filter((p) => p !== 0)),
    weather: voteWeather(sources.map((item) => item.current.weather)),
    sources: sources.map((item) => ({
      source: item.current.source,
      weather: item.current.weather,
      temp: item.current.temp
    }))
  };

  const maxDays = Math.max(...sources.map((item) => item.daily.length));
  const daily = [];

  for (let index = 0; index < Math.min(maxDays, 7); index += 1) {
    const dayEntries = sources
      .map((item) => item.daily[index])
      .filter(Boolean);

    if (!dayEntries.length) continue;

    daily.push({
      date: dayEntries[0].date,
      maxTemp: average(dayEntries.map((entry) => entry.maxTemp).filter((t) => t !== 0)),
      minTemp: average(dayEntries.map((entry) => entry.minTemp).filter((t) => t !== 0)),
      precipitationProbability: average(dayEntries.map((entry) => entry.precipitationProbability).filter((p) => p !== 0)),
      weather: voteWeather(dayEntries.map((entry) => entry.weather)),
      sources: dayEntries.map((entry) => ({
        source: entry.source,
        weather: entry.weather
      }))
    });
  }

  return {
    current,
    daily,
    hourly: buildHourlyForecast(sources)
  };
}

function formatDateLabel(dateString) {
  const date = new Date(dateString + 'T00:00:00Z');
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const week = ['日', '月', '火', '水', '木', '金', '土'];
  return `${month}/${day} (${week[date.getUTCDay()]})`;
}

function formatHourLabel(timeString) {
  const date = new Date(timeString);
  return `${date.getHours()}時`;
}

function App() {
  const [query, setQuery] = useState('東京');
  const [label, setLabel] = useState('東京');
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recentCities, setRecentCities] = useState([]);
  const [isLocating, setIsLocating] = useState(false);

  const today = useMemo(() => forecast?.daily?.[0], [forecast]);
  const tomorrow = useMemo(() => forecast?.daily?.[1], [forecast]);

  const advice = useMemo(() => {
    if (!forecast) return null;
    return getWeatherAdvice(
      forecast.current.temp,
      forecast.current.precipitationProbability,
      forecast.current.weather
    );
  }, [forecast]);

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
        // ignore parse errors
      }
    }

    const savedCities = localStorage.getItem(RECENT_KEY);
    if (savedCities) {
      try {
        const parsed = JSON.parse(savedCities);
        if (Array.isArray(parsed)) setRecentCities(parsed);
      } catch {
        // ignore parse errors
      }
    }

    loadWeather('東京');
  }, []);

  function saveRecentCity(cityName) {
    const cleaned = cityName.trim();
    if (!cleaned) return;
    setRecentCities((prev) => {
      const next = [cleaned, ...prev.filter((item) => item !== cleaned)].slice(0, 6);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function loadWeather(city) {
    const cityValue = city.trim() || '東京';
    setLoading(true);
    setError('');

    try {
      const loc = await geocodeLocation(cityValue);
      const sources = await fetchAllWeatherSources(cityValue, loc.latitude, loc.longitude);
      const aggregated = buildAggregatedForecast(sources);

      const payload = {
        query: cityValue,
        label: loc.label,
        forecast: aggregated,
        fetchedAt: Date.now()
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      setLabel(loc.label);
      setForecast(aggregated);
      saveRecentCity(cityValue);
    } catch (err) {
      setError(err.message || '予報の取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  }

  async function useCurrentLocation() {
    if (!navigator.geolocation) {
      setError('この端末では現在地取得が対応していません。');
      return;
    }

    setIsLocating(true);
    setError('');

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const lat = position.coords.latitude;
          const lon = position.coords.longitude;
          const placeName = await reverseGeocodeLocation(lat, lon);
          const sources = await fetchAllWeatherSources(placeName, lat, lon);
          const aggregated = buildAggregatedForecast(sources);

          const payload = {
            query: placeName,
            label: placeName,
            forecast: aggregated,
            fetchedAt: Date.now()
          };

          localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
          setQuery(placeName);
          setLabel(placeName);
          setForecast(aggregated);
          saveRecentCity(placeName);
        } catch (err) {
          setError(err.message || '現在地の天気を取得できませんでした。');
        } finally {
          setIsLocating(false);
        }
      },
      () => {
        setError('現在地の取得が拒否されました。');
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  const handleSubmit = (event) => {
    event.preventDefault();
    loadWeather(query);
  };

  return (
    <div className="app-shell">
      <div className="container">
        <header className="header">
          <p className="eyebrow">完全無料・複数ソース統合</p>
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

        <div className="utility-row">
          <button type="button" className="utility-button" onClick={() => loadWeather(query || '東京')} disabled={loading}>
            更新
          </button>
          <button type="button" className="utility-button soft" onClick={useCurrentLocation} disabled={isLocating}>
            {isLocating ? '位置取得中...' : '現在地'}
          </button>
        </div>

        {recentCities.length > 0 && (
          <div className="quick-actions">
            <span className="mini-label">最近検索</span>
            <div className="chip-list">
              {recentCities.map((city) => (
                <button
                  type="button"
                  key={city}
                  className="city-chip"
                  onClick={() => {
                    setQuery(city);
                    loadWeather(city);
                  }}
                >
                  {city}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <div className="error-box">{error}</div>}

        {forecast && advice && (
          <div className="summary-grid">
            <div className="summary-card">
              <span className="summary-label">服装</span>
              <strong>{advice.outfit}</strong>
            </div>
            <div className="summary-card">
              <span className="summary-label">傘</span>
              <strong>{advice.umbrella}</strong>
            </div>
            <div className="summary-card accent">
              <span className="summary-label">ポイント</span>
              <strong>{advice.accent}</strong>
            </div>
          </div>
        )}

        {forecast && (
          <>
            <section className="location-box">
              <span>📍 {label}</span>
              <span className="source-count">{forecast.current.sources?.length || 0}つの無料ソースを統合</span>
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
                  <li>降水: {Math.round(forecast.current.precipitationProbability)}%</li>
                </ul>
                {forecast.current.sources && forecast.current.sources.length > 0 && (
                  <div className="sources-small">
                    <p className="sources-label">各ソース:</p>
                    {forecast.current.sources.map((src, idx) => (
                      <div key={idx} className="source-item">
                        <span className="source-name">{src.source}</span>
                        <span className="source-weather">{src.weather}</span>
                        {src.temp !== 0 && <span className="source-temp">{Math.round(src.temp)}°C</span>}
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

            <section className="hourly-panel panel">
              <div className="panel-header">
                <span>1時間ごとの天気</span>
                <span className="chip">24時間</span>
              </div>
              <div className="hourly-strip">
                {forecast.hourly?.slice(0, 24).map((hour) => (
                  <div className="hour-card" key={hour.time}>
                    <span className="hour-time">{formatHourLabel(hour.time)}</span>
                    <strong>{Math.round(hour.temp)}°</strong>
                    <span className="hour-weather">{hour.weather}</span>
                    <span className="hour-rain">降水 {Math.round(hour.precipitationProbability)}%</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="week-panel">
              <h2>7日間の予報</h2>
              <div className="week-grid">
                {forecast.daily.slice(0, 7).map((day, index) => (
                  <div key={`${day.date}-${index}`} className="day-card">
                    <div className="day-label">{formatDateLabel(day.date)}</div>
                    <div className="day-weather">{day.weather}</div>
                    <div className="temp-line">
                      {day.maxTemp !== 0 && <span>{Math.round(day.maxTemp)}°</span>}
                      {day.minTemp !== 0 && <span className="low">{Math.round(day.minTemp)}°</span>}
                    </div>
                    {day.precipitationProbability !== 0 && (
                      <div className="rain">降水 {Math.round(day.precipitationProbability)}%</div>
                    )}
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
