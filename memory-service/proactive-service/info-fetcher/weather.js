/**
 * Weather Source - 天气数据源
 *
 * 严格遵循补充规划 2.1：
 * - 首选 Open-Meteo（免费、无 Key、支持中文城市）
 * - 回退 wttr.in
 * - 天气突变检测（降温 >5°C / 降雨 >70%）
 */

const config = require('../../config');

const WMO_CODES = {
  0: '晴', 1: '多云', 2: '阴', 3: '阴',
  45: '雾', 48: '雾',
  51: '毛毛雨', 53: '毛毛雨', 55: '毛毛雨',
  56: '冻毛毛雨', 57: '冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  66: '冻雨', 67: '冻雨',
  71: '小雪', 73: '中雪', 75: '大雪',
  77: '雪粒',
  80: '阵雨', 81: '中阵雨', 82: '大阵雨',
  85: '小阵雪', 86: '大阵雪',
  95: '雷暴', 96: '雷暴加冰雹', 99: '雷暴加冰雹',
};

/**
 * 通过 Open-Meteo 获取天气
 * @param {string} city - 城市名
 * @param {number} lat - 纬度
 * @param {number} lon - 经度
 */
async function getWeather(city = '广州', lat = 23.13, lon = 113.26) {
  // 使用 current_weather=true（兼容性最好的参数格式）
  const url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current_weather=true` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum` +
    `&timezone=Asia%2FShanghai`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}: ${res.statusText}`);

  const data = await res.json();

  return {
    city,
    temp: data.current_weather.temperature,
    feelsLike: null,
    humidity: null,
    maxTemp: data.daily.temperature_2m_max[0],
    minTemp: data.daily.temperature_2m_min[0],
    rainProb: data.daily.precipitation_sum ? Math.min(100, data.daily.precipitation_sum[0] * 10) : null,
    weatherCode: data.current_weather.weathercode,
    description: decodeWMO(data.current_weather.weathercode),
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 回退方案：通过 wttr.in 获取天气（文本格式）
 */
async function getWeatherFallback(city = '广州') {
  try {
    const url = `https://wttr.in/${encodeURIComponent(city)}?format=%C+%t&lang=zh`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('wttr.in 失败');
    const text = await res.text();
    return {
      city,
      temp: null,
      feelsLike: null,
      description: text.trim(),
      fetchedAt: new Date().toISOString(),
      fallback: true,
    };
  } catch {
    return null;
  }
}

/**
 * 获取天气（自动降级）
 */
async function fetchWeather(city) {
  try {
    return await getWeather(city);
  } catch (e1) {
    console.log(`[weather] Open-Meteo 失败: ${e1.message}，尝试 wttr.in`);
    const fallback = await getWeatherFallback(city);
    if (fallback) return fallback;
    console.log(`[weather] 所有天气源均不可用`);
    return null;
  }
}

/**
 * 天气突变检测
 * @param {Object} todayWeather - 今日天气
 * @param {Object|null} yesterdayWeather - 昨日天气（缓存）
 * @returns {Object|null} - 突变告警信息
 */
function checkWeatherAlert(todayWeather, yesterdayWeather) {
  if (!todayWeather || todayWeather.fallback) return null;
  if (!yesterdayWeather || yesterdayWeather.fallback) return null;

  // 气温骤降检测
  if (todayWeather.maxTemp != null && yesterdayWeather.maxTemp != null) {
    const tempDrop = yesterdayWeather.maxTemp - todayWeather.maxTemp;
    if (tempDrop > 5) {
      return {
        type: 'cold_alert',
        severity: 'warning',
        detail: `今天最高温比昨天降了${tempDrop.toFixed(1)}°C，记得加衣服`,
        tempDrop,
      };
    }
  }

  // 高降雨概率检测
  if (todayWeather.rainProb != null && todayWeather.rainProb > 70) {
    return {
      type: 'rain_alert',
      severity: 'info',
      detail: `今天降雨概率 ${todayWeather.rainProb}%，出门记得带伞`,
      rainProb: todayWeather.rainProb,
    };
  }

  return null;
}

function decodeWMO(code) {
  return WMO_CODES[code] || `未知天气(${code})`;
}

module.exports = { fetchWeather, getWeather, checkWeatherAlert, decodeWMO };
