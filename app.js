(() => {
  'use strict';

  const STORAGE_KEY = 'tradepath-learning-v1';
  const HOURLY_SCAN_KEY = 'tradepath-hourly-scan-v1';
  const ACCOUNTS_KEY = 'tradepath-local-accounts-v1';
  const LAST_EMAIL_KEY = 'tradepath-last-email-v1';
  const MAX_WATCH_SYMBOLS = 16;
  const DEFAULT_WATCH_SYMBOLS = ['US30', 'GER40', 'UK100', 'US500', 'NAS100', 'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'XAUUSD'];
  const PASSWORD_ITERATIONS = 310000;
  const lessons = [
    {
      id: 'trend',
      number: '01',
      symbol: '↗',
      title: 'Trend following',
      description: 'Learn to recognize direction and wait for a setup that fits your rules.',
      overview: 'A trend-following approach looks for evidence that price is moving consistently in one direction. The goal is to define what confirms a trend—and what would invalidate your idea—before taking a paper trade.',
      steps: ['Define the trend using a consistent method.', 'Wait for your entry conditions; avoid chasing a sharp move.', 'Set an invalidation point and planned risk before entry.'],
      caution: 'Markets can reverse, and past price movement does not predict future results.'
    },
    {
      id: 'levels',
      number: '02',
      symbol: '↔',
      title: 'Support & resistance',
      description: 'Explore how traders mark areas where price has reacted before.',
      overview: 'Support and resistance are areas of interest, not precise barriers. Traders study prior reactions and plan for more than one possibility instead of assuming a level will hold.',
      steps: ['Mark a zone where price previously reacted more than once.', 'Wait for a clear reaction; a touch alone is not confirmation.', 'Decide in advance what would show the idea is wrong.'],
      caution: 'Price can move through a zone. These areas are subjective and never guarantees.'
    },
    {
      id: 'risk',
      number: '03',
      symbol: '◎',
      title: 'Risk management',
      description: 'Make your possible loss part of the plan—not an afterthought.',
      overview: 'Risk management is about defining how much you could lose if your idea fails. Position size should follow the distance to the invalidation point and a predetermined risk budget.',
      steps: ['Choose a maximum hypothetical loss for the idea.', 'Measure the distance from entry to the stop or invalidation.', 'Calculate position size and account for fees and slippage.'],
      caution: 'Stops may fill at a worse price than expected, and losses can exceed the planned amount.'
    }
  ];

  const scenarios = [
    {
      title: 'A trend, but no clear entry',
      description: 'Price has been making higher highs. It just jumped quickly after a news headline, and your entry rules have not triggered.',
      context: 'Upward move after news',
      focus: 'Follow your entry rules',
      answer: 'Wait for my setup',
      feedback: 'A rules-based response is to wait. A strong move by itself is not a complete setup. Check your entry criteria and risk plan before considering a paper trade.',
      tone: 'good',
      points: [31, 43, 35, 56, 49, 67, 53, 78, 70, 91]
    },
    {
      title: 'Price reaches a familiar zone',
      description: 'Price revisits an area that acted as resistance before. You have not yet seen a clear reaction or confirmation.',
      context: 'Price at a prior level',
      focus: 'Look for confirmation',
      answer: 'Wait for a reaction',
      feedback: 'A level is an area to observe, not a promise. Waiting for the reaction in your plan helps avoid treating a line on a chart as a guarantee.',
      tone: 'good',
      points: [77, 65, 72, 53, 61, 43, 54, 35, 48, 37]
    },
    {
      title: 'Your planned loss is too large',
      description: 'A setup meets your entry criteria, but the position size would put more at risk than your pre-set practice limit.',
      context: 'Setup meets your rules',
      focus: 'Respect the risk limit',
      answer: 'Reduce size or skip',
      feedback: 'Protecting your risk limit comes first. You can reduce the hypothetical size to fit the plan—or skip. A valid setup does not require taking an oversized position.',
      tone: 'good',
      points: [40, 48, 42, 59, 49, 66, 57, 73, 62, 79]
    }
  ];

  const questions = [
    {
      prompt: 'What should you decide before entering a paper trade?',
      options: ['How much you are willing to risk and what invalidates the idea', 'Only the price target', 'How to make back a previous loss'],
      answer: 0,
      explanation: 'A plan includes the risk and the point where the idea is no longer valid—not only a target.'
    },
    {
      prompt: 'What does a support or resistance area tell you?',
      options: ['Price must reverse there', 'It is an area to observe, not a guaranteed barrier', 'The asset is safe to buy or sell'],
      answer: 1,
      explanation: 'Price can react to, or move through, a level. It is an observation—not a guarantee.'
    },
    {
      prompt: 'If your setup exceeds your planned risk limit, what is a thoughtful response?',
      options: ['Increase the risk limit because the setup looks good', 'Ignore the stop', 'Reduce the hypothetical position size or skip'],
      answer: 2,
      explanation: 'Keep your risk rule intact. Reducing the size or skipping are both valid choices.'
    }
  ];

  const emptyProgress = () => ({ explored: [], scenarios: 0, journal: [], quizDone: false });
  let state = emptyProgress();
  let activeScenario = 0;
  let scenarioAnswered = false;
  let activeQuestion = 0;
  let questionAnswered = false;
  let quizScore = 0;
  let mt5PollInProgress = false;
  let latestReports = [];
  let activeUser = null;
  let watchSymbols = [...DEFAULT_WATCH_SYMBOLS];
  let hourlyReviewEnabled = false;
  let hourlyToneEnabled = false;
  let audioContext = null;
  let lastHourlyScanSlot = null;

  function userStorageKey(key) {
    if (!activeUser) throw new Error('Sign in before accessing saved profile data.');
    return `${key}:${activeUser.id}`;
  }

  function defaultPreferences() {
    return {
      watchSymbols: [...DEFAULT_WATCH_SYMBOLS],
      preferredStrategy: 'compare',
      riskPercent: 1,
      audioAlerts: false
    };
  }

  function normalizePreferences(preferences) {
    const defaults = defaultPreferences();
    if (!preferences || typeof preferences !== 'object') return defaults;
    const watchlist = Array.isArray(preferences.watchSymbols)
      ? [...new Set(preferences.watchSymbols.filter(symbol => typeof symbol === 'string' && /^[A-Za-z0-9._-]{1,32}$/u.test(symbol)))].slice(0, MAX_WATCH_SYMBOLS)
      : defaults.watchSymbols;
    const validStrategies = ['compare', 'trend', 'levels', 'volatility'];
    const riskPercent = Number(preferences.riskPercent);
    return {
      watchSymbols: watchlist,
      preferredStrategy: validStrategies.includes(preferences.preferredStrategy) ? preferences.preferredStrategy : defaults.preferredStrategy,
      riskPercent: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].includes(riskPercent) ? riskPercent : defaults.riskPercent,
      audioAlerts: preferences.audioAlerts === true
    };
  }

  function loadAccounts() {
    try {
      const saved = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]');
      if (!Array.isArray(saved)) return [];
      return saved.filter(account =>
        account && typeof account.id === 'string' &&
        typeof account.email === 'string' &&
        typeof account.salt === 'string' &&
        typeof account.passwordHash === 'string'
      ).map(account => ({ ...account, preferences: normalizePreferences(account.preferences) }));
    } catch (error) {
      console.error('TradePath could not read local profiles.', error);
      return [];
    }
  }

  function persistAccounts(accounts) {
    try {
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
      return true;
    } catch (error) {
      console.error('TradePath could not save local profiles.', error);
      return false;
    }
  }

  function rememberEmail(email) {
    try {
      localStorage.setItem(LAST_EMAIL_KEY, email);
    } catch (error) {
      console.warn('TradePath could not remember the local email address.', error);
    }
  }

  function saveUserPreferences() {
    if (!activeUser) return false;
    const accounts = loadAccounts();
    const index = accounts.findIndex(account => account.id === activeUser.id);
    if (index < 0) {
      console.error('TradePath could not find the signed-in local profile.');
      return false;
    }
    accounts[index].preferences = normalizePreferences(activeUser.preferences);
    if (!persistAccounts(accounts)) return false;
    activeUser = accounts[index];
    return true;
  }

  function supportsLocalPasswordHashing() {
    return window.isSecureContext && window.crypto && window.crypto.subtle;
  }

  function bytesToHex(bytes) {
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function hexToBytes(hex) {
    if (typeof hex !== 'string' || !/^(?:[0-9a-f]{2})+$/iu.test(hex)) return new Uint8Array();
    return Uint8Array.from(hex.match(/.{2}/gu), byte => Number.parseInt(byte, 16));
  }

  async function derivePasswordHash(password, salt) {
    const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    return crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: PASSWORD_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      256
    );
  }

  function sameBytes(left, right) {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
    return difference === 0;
  }

  function parseWatchSymbols(value) {
    const symbols = [...new Set(value.split(',').map(symbol => symbol.trim().toUpperCase()).filter(Boolean))];
    if (symbols.length > MAX_WATCH_SYMBOLS) {
      throw new Error(`Choose no more than ${MAX_WATCH_SYMBOLS} symbols.`);
    }
    if (symbols.some(symbol => !/^[A-Z0-9._-]{1,32}$/u.test(symbol))) {
      throw new Error('Symbols may contain letters, numbers, dots, underscores, and hyphens only.');
    }
    return symbols;
  }

  function setAuthMode(mode, message = '') {
    const signup = document.getElementById('signupForm');
    const login = document.getElementById('loginForm');
    const isSignup = mode === 'signup';
    signup.hidden = !isSignup;
    login.hidden = isSignup;
    document.getElementById('authTitle').innerHTML = isSignup
      ? 'A learning plan <span>that remembers you.</span>'
      : 'Welcome <span>back.</span>';
    document.getElementById(isSignup ? 'loginError' : 'signupError').textContent = '';
    document.getElementById('loginError').textContent = isSignup ? '' : message;
    document.getElementById('signupError').textContent = isSignup ? message : '';
    const email = document.getElementById(isSignup ? 'signupEmail' : 'loginEmail');
    if (!email.value) {
      try {
        email.value = localStorage.getItem(LAST_EMAIL_KEY) || '';
      } catch (error) {
        console.warn('TradePath could not load the remembered local email.', error);
      }
    }
    email.focus();
  }

  function setAppLocked(locked) {
    document.body.classList.toggle('auth-locked', locked);
    document.getElementById('authGate').hidden = !locked;
    Array.from(document.body.children).forEach(child => {
      if (child.id !== 'authGate' && child.id !== 'installAppStatus') child.inert = locked;
    });
  }

  function applyPreferences() {
    const preferences = normalizePreferences(activeUser.preferences);
    activeUser.preferences = preferences;
    watchSymbols = [...preferences.watchSymbols];
    document.getElementById('preferredStrategy').value = preferences.preferredStrategy;
    document.getElementById('profileRiskPercent').value = String(preferences.riskPercent);
    document.getElementById('riskPercent').value = String(preferences.riskPercent);
    hourlyToneEnabled = preferences.audioAlerts;
    document.getElementById('hourlyToneEnabled').checked = hourlyToneEnabled;
    document.getElementById('signedInEmail').textContent = activeUser.email;
    document.getElementById('signOutButton').hidden = false;
    renderWatchlist();
    updateRisk();
    updatePreferredStrategy();
  }

  function updatePreferredStrategy() {
    if (!activeUser) return;
    const preference = activeUser.preferences.preferredStrategy;
    document.querySelectorAll('.strategy-match').forEach(card => {
      const id = card.id;
      const focus = preference === 'compare' ||
        (preference === 'trend' && id === 'trendMatch') ||
        (preference === 'levels' && id === 'levelsMatch') ||
        (preference === 'volatility' && id === 'volatilityMatch');
      card.classList.toggle('strategy-match-priority', focus && preference !== 'compare');
    });
    const names = { compare: 'Compare all checklists', trend: 'Trend following', levels: 'Support and resistance', volatility: 'Volatility context' };
    const heading = document.querySelector('.strategy-coach-heading h3');
    if (heading) heading.textContent = preference === 'compare' ? 'What does the chart resemble?' : `Your focus: ${names[preference]}`;
  }

  function openAuthenticatedProfile(user) {
    activeUser = user;
    state = loadProgress();
    watchSymbols = loadWatchSymbols();
    hourlyReviewEnabled = loadHourlyPreference();
    hourlyToneEnabled = activeUser.preferences.audioAlerts === true;
    lastHourlyScanSlot = loadLastHourlySlot();
    applyPreferences();
    renderProgress();
    renderJournal();
    updateHourlyControls();
    setAppLocked(false);
    pollMt5Status();
  }

  async function createLocalAccount(event) {
    event.preventDefault();
    const errorElement = document.getElementById('signupError');
    const submit = document.getElementById('signupSubmit');
    errorElement.textContent = '';
    const email = document.getElementById('signupEmail').value.trim().toLowerCase();
    const password = document.getElementById('signupPassword').value;
    const confirm = document.getElementById('signupConfirm').value;
    if (!supportsLocalPasswordHashing()) {
      errorElement.textContent = 'Secure browser password hashing is unavailable. Open TradePath through the local node bridge URL.';
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 254) {
      errorElement.textContent = 'Enter a valid email address.';
      return;
    }
    if (password.length < 12 || !/[a-z]/u.test(password) || !/[A-Z]/u.test(password) || !/\d/u.test(password) || !/[^\p{L}\p{N}]/u.test(password)) {
      errorElement.textContent = 'Choose a password with at least 12 characters, an uppercase and lowercase letter, a number, and a symbol.';
      return;
    }
    if (password !== confirm) {
      errorElement.textContent = 'The passwords do not match.';
      return;
    }
    let symbols;
    try {
      symbols = parseWatchSymbols(document.getElementById('signupSymbols').value);
    } catch (error) {
      errorElement.textContent = error.message;
      return;
    }
    const accounts = loadAccounts();
    if (accounts.some(account => account.email === email)) {
      errorElement.textContent = 'A profile for this email already exists on this device. Sign in instead.';
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Creating your local profile…';
    try {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const passwordHash = bytesToHex(await derivePasswordHash(password, salt));
      const user = {
        id: crypto.randomUUID(),
        email,
        salt: bytesToHex(salt),
        passwordHash,
        preferences: {
          watchSymbols: symbols,
          preferredStrategy: document.getElementById('signupStrategy').value,
          riskPercent: Number(document.getElementById('signupRisk').value)
        }
      };
      if (!persistAccounts([...accounts, user])) {
        errorElement.textContent = 'The profile could not be saved. Check browser storage and try again.';
        return;
      }
      rememberEmail(email);
      document.getElementById('signupPassword').value = '';
      document.getElementById('signupConfirm').value = '';
      openAuthenticatedProfile(user);
    } catch (error) {
      console.error('TradePath could not create the local profile.', error);
      errorElement.textContent = 'Could not create the local profile. Check browser storage and try again.';
    } finally {
      submit.disabled = false;
      submit.innerHTML = 'Create local profile <span aria-hidden="true">→</span>';
    }
  }

  async function signIntoLocalAccount(event) {
    event.preventDefault();
    const errorElement = document.getElementById('loginError');
    const submit = document.getElementById('loginSubmit');
    errorElement.textContent = '';
    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    const password = document.getElementById('loginPassword').value;
    if (!supportsLocalPasswordHashing()) {
      errorElement.textContent = 'Secure browser password hashing is unavailable. Open TradePath through the local node bridge URL.';
      return;
    }
    const user = loadAccounts().find(account => account.email === email);
    if (!user) {
      errorElement.textContent = 'No local profile matches that email. Create a profile on this device first.';
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Checking your password…';
    try {
      const expected = hexToBytes(user.passwordHash);
      const actual = new Uint8Array(await derivePasswordHash(password, hexToBytes(user.salt)));
      if (!sameBytes(actual, expected)) {
        errorElement.textContent = 'That email and password do not match a local profile.';
        return;
      }
      rememberEmail(email);
      document.getElementById('loginPassword').value = '';
      openAuthenticatedProfile(user);
    } catch (error) {
      console.error('TradePath could not sign in to the local profile.', error);
      errorElement.textContent = 'Could not check the local profile. Check browser storage and try again.';
    } finally {
      submit.disabled = false;
      submit.innerHTML = 'Sign in <span aria-hidden="true">→</span>';
    }
  }

  function signOutLocalAccount() {
    activeUser = null;
    state = emptyProgress();
    watchSymbols = [...DEFAULT_WATCH_SYMBOLS];
    hourlyReviewEnabled = false;
    hourlyToneEnabled = false;
    lastHourlyScanSlot = null;
    document.getElementById('signOutButton').hidden = true;
    setAppLocked(true);
    setAuthMode(loadAccounts().length ? 'login' : 'signup');
  }

  function initializeLocalAuth() {
    const accounts = loadAccounts();
    const rememberedEmail = (() => {
      try { return localStorage.getItem(LAST_EMAIL_KEY) || ''; }
      catch (error) {
        console.warn('TradePath could not load the remembered local email.', error);
        return '';
      }
    })();
    document.getElementById('signupEmail').value = rememberedEmail;
    document.getElementById('loginEmail').value = rememberedEmail;
    setAppLocked(true);
    setAuthMode(accounts.length ? 'login' : 'signup');
    document.getElementById('signupForm').addEventListener('submit', createLocalAccount);
    document.getElementById('loginForm').addEventListener('submit', signIntoLocalAccount);
    document.getElementById('showLogin').addEventListener('click', () => setAuthMode('login'));
    document.getElementById('showSignup').addEventListener('click', () => setAuthMode('signup'));
    document.getElementById('signOutButton').addEventListener('click', signOutLocalAccount);
  }

  function loadProgress() {
    try {
      const saved = JSON.parse(localStorage.getItem(userStorageKey(STORAGE_KEY)));
      if (!saved || typeof saved !== 'object') return emptyProgress();
      return {
        explored: Array.isArray(saved.explored) ? saved.explored.filter(id => lessons.some(lesson => lesson.id === id)) : [],
        scenarios: Number.isInteger(saved.scenarios) && saved.scenarios >= 0 ? saved.scenarios : 0,
        journal: Array.isArray(saved.journal) ? saved.journal.filter(entry =>
          entry && typeof entry.id === 'string' &&
          typeof entry.strategy === 'string' &&
          typeof entry.emotion === 'string' &&
          typeof entry.notes === 'string' &&
          typeof entry.date === 'string'
        ).slice(0, 20) : [],
        quizDone: saved.quizDone === true
      };
    } catch (error) {
      console.warn('TradePath could not load saved progress.', error);
      return emptyProgress();
    }
  }

  function saveProgress() {
    if (!activeUser) return;
    try {
      localStorage.setItem(userStorageKey(STORAGE_KEY), JSON.stringify(state));
    } catch (error) {
      console.error('TradePath could not save progress.', error);
      const message = document.getElementById('journalMessage');
      if (message) message.textContent = 'Could not save on this device. Check browser storage settings.';
    }
    renderProgress();
  }

  function renderProgress() {
    const completed = state.explored.length + (state.scenarios > 0 ? 1 : 0) + (state.quizDone ? 1 : 0);
    const percent = Math.round(completed / 5 * 100);
    document.getElementById('lessonsDone').textContent = String(state.explored.length);
    document.getElementById('scenariosDone').textContent = String(state.scenarios);
    document.getElementById('journalCount').textContent = String(state.journal.length);
    document.getElementById('progressPercent').textContent = `${percent}%`;
    document.querySelector('.progress-track').setAttribute('aria-valuenow', String(percent));
    document.getElementById('progressBar').style.width = `${percent}%`;
  }

  function setMt5Status(state, title, description) {
    const dot = document.getElementById('mt5StatusDot');
    dot.dataset.state = state;
    document.getElementById('mt5Badge').textContent = title;
    document.getElementById('mt5ConnectionText').textContent = description;
  }

  function emaSeries(values, period) {
    const multiplier = 2 / (period + 1);
    return values.map((value, index) => {
      if (index === 0) return value;
      return value * multiplier + values[index - 1] * (1 - multiplier);
    });
  }

  function analyzeMt5Chart(report) {
    const bars = report.bars;
    const closes = bars.map(bar => bar.close);
    const ema20 = emaSeries(closes, 20);
    const ema50 = emaSeries(closes, 50);
    const trueRanges = bars.map((bar, index) => {
      if (index === 0) return bar.high - bar.low;
      const previousClose = bars[index - 1].close;
      return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
    });
    const rangeWindow = trueRanges.slice(-14);
    const atr = rangeWindow.reduce((sum, value) => sum + value, 0) / rangeWindow.length;
    const baselineWindow = trueRanges.slice(-64, -14);
    const baselineAtr = baselineWindow.length
      ? baselineWindow.reduce((sum, value) => sum + value, 0) / baselineWindow.length
      : atr;
    const recent = bars.slice(-50);
    const recentLows = recent.map(bar => bar.low);
    const recentHighs = recent.map(bar => bar.high);
    const support = Math.min(...recentLows);
    const resistance = Math.max(...recentHighs);
    const close = closes[closes.length - 1];
    let trend = 'Mixed / unclear trend context.';
    let trendCondition = null;
    if (bars.length >= 60) {
      const previousEma20 = ema20[ema20.length - 6];
      if (close > ema20[ema20.length - 1] && ema20[ema20.length - 1] > ema50[ema50.length - 1] && ema20[ema20.length - 1] > previousEma20) {
        trend = 'Upward trend context: price is above rising EMA20, which is above EMA50. Not an entry signal.';
        trendCondition = 'rising';
      } else if (close < ema20[ema20.length - 1] && ema20[ema20.length - 1] < ema50[ema50.length - 1] && ema20[ema20.length - 1] < previousEma20) {
        trend = 'Downward trend context: price is below falling EMA20, which is below EMA50. Not an entry signal.';
        trendCondition = 'falling';
      } else {
        trend = 'The EMA20, EMA50, and latest close do not align clearly. Trend-following context is mixed.';
      }
    } else {
      trend = 'At least 60 candles are needed for a more established EMA trend comparison.';
    }

    const nearSupport = atr > 0 && close - support <= atr * 0.35;
    const nearResistance = atr > 0 && resistance - close <= atr * 0.35;
    let level = `Within the last ${recent.length} candles: support area near ${formatPrice(support, report.digits)}; resistance area near ${formatPrice(resistance, report.digits)}. These are approximate.`;
    if (nearSupport) {
      level = `Near a recent support area (${formatPrice(support, report.digits)}); observe only. A level can fail.`;
    } else if (nearResistance) {
      level = `Near a recent resistance area (${formatPrice(resistance, report.digits)}); observe only. A level can break.`;
    }
    const emaSeparation = atr > 0 ? Math.abs(ema20[ema20.length - 1] - ema50[ema50.length - 1]) / atr : Infinity;
    const recentRange = resistance - support;
    const rangePosition = recentRange > 0 ? (close - support) / recentRange : 0.5;
    const rangeLike = bars.length >= 60 && emaSeparation <= 0.4 && rangePosition > 0.15 && rangePosition < 0.85;
    let volatility = 'Typical recent volatility; no clear expansion or compression in this simple check.';
    let volatilityFit = false;
    if (baselineWindow.length < 20) {
      volatility = 'More candle history is needed to compare recent and baseline volatility.';
    } else if (baselineAtr > 0) {
      const volatilityRatio = atr / baselineAtr;
      if (volatilityRatio >= 1.5) {
        volatility = 'Recent candle ranges are elevated versus the preceding baseline (expansion context). This can mean faster, less predictable price moves.';
        volatilityFit = true;
      } else if (volatilityRatio <= 0.65) {
        volatility = 'Recent candle ranges are lower than the preceding baseline (quiet context). A breakout is not confirmed by this observation.';
        volatilityFit = true;
      }
    }

    const strategyMatches = [
      {
        id: 'trendMatch',
        title: 'Trend following',
        score: trendCondition ? 2 : bars.length < 60 ? 0 : 1,
        label: trendCondition ? 'Direction aligned' : bars.length < 60 ? 'Insufficient history' : 'Mixed context',
        detail: trendCondition ? 'EMA20 slope, EMA ordering, and close align.' : 'The trend checklist is incomplete.'
      },
      {
        id: 'levelsMatch',
        title: 'Support / resistance',
        score: nearSupport || nearResistance ? 2 : rangeLike ? 1 : 0,
        label: nearSupport ? 'Near recent support' : nearResistance ? 'Near recent resistance' : rangeLike ? 'Range-like context' : 'No clear level reaction',
        detail: nearSupport || nearResistance ? 'Price is near a recent area to observe, not a confirmed reversal.' : rangeLike ? 'Recent averages are compressed; this is not a confirmed range.' : 'No simple level-based condition stands out.'
      },
      {
        id: 'volatilityMatch',
        title: 'Volatility',
        score: volatilityFit ? 2 : baselineWindow.length < 20 ? 0 : 1,
        label: baselineWindow.length < 20 ? 'Insufficient history' : volatilityFit ? 'Range regime changed' : 'Typical recent range',
        detail: volatilityFit ? 'Recent candle ranges differ from the baseline.' : 'Recent candle ranges are near their baseline.'
      }
    ];
    const highestScore = Math.max(...strategyMatches.map(match => match.score));
    const topMatches = highestScore > 0 ? strategyMatches.filter(match => match.score === highestScore) : [];
    const coachSummary = topMatches.length === 1 && highestScore === 2
      ? `Closest educational checklist match: ${topMatches[0].title}. ${topMatches[0].detail} This describes recent candles only; it is not an entry signal or a recommendation to trade.`
      : topMatches.length > 0
        ? `No single strategy checklist stands out. ${topMatches.map(match => match.title).join(' and ')} show ${highestScore === 1 ? 'only partial context' : 'similar context'}. Review your own written rules; if they do not confirm a complete setup, there is no checklist-based reason to act.`
        : 'No strategy checklist currently stands out from this chart history. Waiting or gathering more information is also a valid learning outcome.';

    const minClose = Math.min(...closes);
    const maxClose = Math.max(...closes);
    const chartY = value => 190 - (value - minClose) / (maxClose - minClose || 1) * 170;
    const chartX = index => index * 400 / Math.max(1, closes.length - 1);
    const closeLine = closes.map((value, index) => `${chartX(index)},${chartY(value)}`).join(' ');
    const ema20Line = ema20.map((value, index) => `${chartX(index)},${chartY(value)}`).join(' ');
    const ema50Line = ema50.map((value, index) => `${chartX(index)},${chartY(value)}`).join(' ');
    return {
      close,
      trend,
      level,
      volatility,
      strategyMatches,
      coachSummary,
      chart: `<svg viewBox="0 0 400 200" preserveAspectRatio="none" aria-label="Recent closing prices, with EMA20 and EMA50 overlays">
        <line x1="0" y1="50" x2="400" y2="50" stroke="#edf0eb" stroke-dasharray="3 5"/>
        <line x1="0" y1="100" x2="400" y2="100" stroke="#edf0eb" stroke-dasharray="3 5"/>
        <line x1="0" y1="150" x2="400" y2="150" stroke="#edf0eb" stroke-dasharray="3 5"/>
        <polyline points="${ema50Line}" fill="none" stroke="#d6a16e" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
        <polyline points="${ema20Line}" fill="none" stroke="#6b9772" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
        <polyline points="${closeLine}" fill="none" stroke="#345f43" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      </svg>`,
      chartMeta: `${bars.length} recent candles · close (green) · EMA20 (sage) · EMA50 (gold)`
    };
  }

  function formatPrice(value, digits) {
    return new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  }

  function renderMt5Status(status) {
    latestReports = status && Array.isArray(status.reports)
      ? status.reports
      : status && status.report
        ? [{ ...status.report, age_seconds: status.age_seconds }]
        : [];
    renderWatchlist();
    const report = status && status.report;
    if (!report || !Array.isArray(report.bars) || report.bars.length < 20) {
      setMt5Status('disconnected', 'Waiting for MetaTrader', 'Attach the TradePathMonitor EA to an MT4 or MT5 chart.');
      document.getElementById('mt5Symbol').textContent = '—';
      document.getElementById('mt5Price').textContent = '—';
      document.getElementById('mt5Timeframe').textContent = '—';
      document.getElementById('mt5Updated').textContent = '—';
      return;
    }

    const age = Number(status.age_seconds);
    const platform = report.platform === 'MT4' ? 'MT4' : 'MT5';
    const fresh = status.connected === true && Number.isFinite(age) && age <= 15;
    if (fresh) {
      setMt5Status('connected', `${platform} chart connected`, 'Read-only data from this computer.');
    } else {
      const ageText = Number.isFinite(age) ? `${Math.max(0, Math.floor(age))} seconds ago` : 'connection is stale';
      setMt5Status('stale', 'Chart data is stale', `Last update ${ageText}. Check MetaTrader and the local bridge.`);
    }

    const analysis = analyzeMt5Chart(report);
    document.getElementById('mt5Symbol').textContent = report.symbol;
    document.getElementById('mt5Price').textContent = formatPrice(analysis.close, report.digits);
    document.getElementById('mt5Timeframe').textContent = report.timeframe.replace(/^PERIOD_/, '');
    document.getElementById('mt5Updated').textContent = status.received_at
      ? new Date(status.received_at).toLocaleTimeString()
      : '—';
    const chart = document.getElementById('mt5Chart');
    chart.innerHTML = analysis.chart;
    chart.setAttribute('aria-label', `${report.symbol} recent closing prices. Illustrative EMA20 and EMA50 overlays.`);
    document.getElementById('mt5ChartMeta').textContent = analysis.chartMeta;
    document.getElementById('trendAssessment').textContent = analysis.trend;
    document.getElementById('levelsAssessment').textContent = analysis.level;
    document.getElementById('volatilityAssessment').textContent = analysis.volatility;
    analysis.strategyMatches.forEach(match => {
      const card = document.getElementById(match.id);
      card.dataset.fit = match.score === 2 ? 'clear' : match.score === 1 ? 'mixed' : 'none';
      card.querySelector('strong').textContent = match.label;
      card.querySelector('p').textContent = match.detail;
    });
    document.getElementById('mt5Explanation').textContent = analysis.coachSummary;
  }

  function loadWatchSymbols() {
    if (!activeUser) return [...DEFAULT_WATCH_SYMBOLS];
    try {
      const saved = activeUser.preferences.watchSymbols;
      if (!Array.isArray(saved)) return [...DEFAULT_WATCH_SYMBOLS];
      return [...new Set(saved.filter(symbol => typeof symbol === 'string' && /^[A-Za-z0-9._-]{1,32}$/u.test(symbol)))].slice(0, MAX_WATCH_SYMBOLS);
    } catch (error) {
      console.warn('TradePath could not load the saved market watchlist.', error);
      return [...DEFAULT_WATCH_SYMBOLS];
    }
  }

  function loadHourlyPreference() {
    if (!activeUser) return false;
    try {
      return localStorage.getItem(userStorageKey(HOURLY_SCAN_KEY)) === 'enabled';
    } catch (error) {
      console.warn('TradePath could not load hourly review preferences.', error);
      return false;
    }
  }

  function loadLastHourlySlot() {
    if (!activeUser) return null;
    try {
      const value = Number(localStorage.getItem(`${userStorageKey(HOURLY_SCAN_KEY)}-last`));
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch (error) {
      console.warn('TradePath could not load the last review time.', error);
      return null;
    }
  }

  function saveHourlyPreference() {
    if (!activeUser) return;
    try {
      localStorage.setItem(userStorageKey(HOURLY_SCAN_KEY), hourlyReviewEnabled ? 'enabled' : 'disabled');
      if (lastHourlyScanSlot !== null) localStorage.setItem(`${userStorageKey(HOURLY_SCAN_KEY)}-last`, String(lastHourlyScanSlot));
    } catch (error) {
      console.error('TradePath could not save hourly review preferences.', error);
      document.getElementById('hourlyStatus').textContent = 'Could not save this preference on this device.';
    }
  }

  function currentHourSlot(now = new Date()) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).getTime();
  }

  function nextLocalHour(now = new Date()) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1);
  }

  function freshReportForSymbol(symbol) {
    const upperSymbol = symbol.toUpperCase();
    return latestReports.find(report =>
      typeof report.symbol === 'string' &&
      report.symbol.toUpperCase() === upperSymbol &&
      Number.isFinite(Number(report.age_seconds)) &&
      Number(report.age_seconds) <= 15
    ) || null;
  }

  function classifyReport(report) {
    const analysis = analyzeMt5Chart(report);
    const highestScore = Math.max(...analysis.strategyMatches.map(match => match.score));
    let matches = highestScore > 0
      ? analysis.strategyMatches.filter(match => match.score === highestScore)
      : [];
    const preferenceMap = { trend: 'trendMatch', levels: 'levelsMatch', volatility: 'volatilityMatch' };
    const preferredId = activeUser && preferenceMap[activeUser.preferences.preferredStrategy];
    if (preferredId && matches.some(match => match.id === preferredId) && matches.length > 1) {
      matches = matches.filter(match => match.id === preferredId);
    }
    if (matches.length === 0) {
      return { label: 'No clear checklist match', detail: 'The available chart history does not meet these simple learning checks.' };
    }
    if (matches.length > 1 || highestScore < 2) {
      return {
        label: `Mixed context: ${matches.map(match => match.title).join(' / ')}`,
        detail: 'Only partial or tied checklist conditions; no single strategy stands out.'
      };
    }
    const preferred = activeUser && activeUser.preferences.preferredStrategy !== 'compare' &&
      preferenceMap[activeUser.preferences.preferredStrategy] === matches[0].id;
    return {
      label: `${preferred ? 'Your focus · ' : ''}${matches[0].title} context`,
      detail: matches[0].detail
    };
  }

  function renderWatchlist() {
    const container = document.getElementById('watchlistItems');
    if (!container) return;
    const count = document.getElementById('watchCount');
    count.textContent = `${watchSymbols.length} ${watchSymbols.length === 1 ? 'market' : 'markets'}`;
    const input = document.getElementById('watchSymbols');
    if (input && document.activeElement !== input) input.value = watchSymbols.join(', ');
    container.replaceChildren();
    if (watchSymbols.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'watch-empty';
      empty.textContent = 'Add at least one broker symbol to begin.';
      container.append(empty);
      return;
    }
    watchSymbols.forEach(symbol => {
      const report = freshReportForSymbol(symbol);
      const matchingReports = latestReports.filter(item =>
        typeof item.symbol === 'string' && item.symbol.toUpperCase() === symbol.toUpperCase()
      );
      const mostRecent = matchingReports[0];
      const card = document.createElement('article');
      card.className = 'watch-item';
      const status = report ? 'connected' : mostRecent ? 'stale' : 'missing';
      card.dataset.state = status;
      const heading = document.createElement('div');
      heading.className = 'watch-item-head';
      const title = document.createElement('strong');
      title.textContent = symbol;
      const badge = document.createElement('span');
      badge.textContent = report ? report.platform : mostRecent ? 'STALE' : 'NO FEED';
      heading.append(title, badge);
      const detail = document.createElement('p');
      if (report) {
        const match = classifyReport(report);
        detail.textContent = `${report.timeframe.replace(/^PERIOD_/, '')} · ${match.label}`;
      } else if (mostRecent) {
        detail.textContent = 'Waiting for a fresh chart update.';
      } else {
        detail.textContent = 'Attach the EA to this exact broker symbol.';
      }
      card.append(heading, detail);
      container.append(card);
    });
  }

  function setHourlyStatus(message) {
    document.getElementById('hourlyStatus').textContent = message;
  }

  function writeHourlyResults(results) {
    const container = document.getElementById('hourlyResults');
    container.replaceChildren();
    const list = document.createElement('ul');
    results.forEach(result => {
      const item = document.createElement('li');
      item.textContent = result;
      list.append(item);
    });
    container.append(list);
    const time = document.createElement('p');
    time.className = 'hourly-results-time';
    time.textContent = `Reviewed ${new Date().toLocaleString()}. Descriptive chart context only—not a recommendation to trade.`;
    container.append(time);
  }

  function sendHourlyNotification(freshCount, resultLines) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    const availableCount = freshCount;
    const summary = resultLines.slice(0, 3).join(' · ');
    const remaining = resultLines.length > 3 ? ` · and ${resultLines.length - 3} more` : '';
    const notification = new Notification('Mr T · hourly chart review', {
      body: `${availableCount} fresh market chart${availableCount === 1 ? '' : 's'} reviewed. ${summary}${remaining}`,
      tag: 'tradepath-hourly-review'
    });
    notification.onclick = () => {
      window.focus();
      window.location.hash = 'mt5';
      notification.close();
    };
    return true;
  }

  function playHourlyTone() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      setHourlyStatus('This browser does not support sound alerts.');
      return;
    }
    try {
      if (!audioContext) audioContext = new AudioContextClass();
      const startTone = () => {
        const now = audioContext.currentTime;
        [660, 880].forEach((frequency, index) => {
          const oscillator = audioContext.createOscillator();
          const gain = audioContext.createGain();
          const start = now + index * 0.16;
          oscillator.frequency.value = frequency;
          oscillator.type = 'sine';
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(0.12, start + 0.025);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15);
          oscillator.connect(gain);
          gain.connect(audioContext.destination);
          oscillator.start(start);
          oscillator.stop(start + 0.16);
        });
      };
      if (audioContext.state === 'suspended') {
        audioContext.resume().then(startTone).catch(error => {
          console.warn('TradePath could not resume audio for an alert tone.', error);
        });
      } else {
        startTone();
      }
    } catch (error) {
      console.warn('TradePath could not play an alert tone.', error);
      setHourlyStatus('The tone could not play. Tap Test tone to enable sound in this browser.');
    }
  }

  function runHourlyReview(notify = false) {
    const results = [];
    let freshCount = 0;
    watchSymbols.forEach(symbol => {
      const report = freshReportForSymbol(symbol);
      if (!report) {
        results.push(`${symbol}: no fresh chart feed. Check the exact broker symbol and keep its MT4/MT5 chart open.`);
        return;
      }
      freshCount += 1;
      const match = classifyReport(report);
      results.push(`${symbol} (${report.platform}, ${report.timeframe.replace(/^PERIOD_/, '')}): ${match.label}. ${match.detail}`);
    });
    if (watchSymbols.length === 0) results.push('Add symbols to your market watchlist first.');
    writeHourlyResults(results);
    const currentSlot = currentHourSlot();
    lastHourlyScanSlot = currentSlot;
    saveHourlyPreference();
    let notificationSent = false;
    if (notify && freshCount > 0) {
      if (hourlyToneEnabled) playHourlyTone();
      try {
        notificationSent = sendHourlyNotification(freshCount, results.filter((_, index) =>
          freshReportForSymbol(watchSymbols[index]) !== null
        ));
      } catch (error) {
        console.warn('TradePath could not show a desktop notification.', error);
      }
    }
    const notificationText = notificationSent
      ? ' Browser notification sent.'
      : hourlyReviewEnabled && (!('Notification' in window) || Notification.permission === 'denied')
        ? ' Desktop alerts are blocked; allow notifications in browser site settings.'
        : hourlyReviewEnabled && Notification.permission !== 'granted'
          ? ' Allow browser notifications for desktop alerts.'
        : '';
    setHourlyStatus(`${freshCount} of ${watchSymbols.length} watched markets have fresh chart data.${notificationText}`);
  }

  function updateHourlyControls() {
    const toggle = document.getElementById('hourlyToggle');
    toggle.setAttribute('aria-pressed', String(hourlyReviewEnabled));
    toggle.textContent = hourlyReviewEnabled ? 'Turn off hourly review' : 'Enable hourly review';
    if (!hourlyReviewEnabled) {
      setHourlyStatus('Automatic review is off.');
      return;
    }
    const next = nextLocalHour();
    const nextText = next.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const notificationStatus = !('Notification' in window)
      ? 'in-app review only'
      : Notification.permission === 'granted'
        ? 'desktop alerts enabled'
        : Notification.permission === 'denied'
          ? 'desktop alerts blocked in site settings'
          : 'in-app review only until permission is granted';
    setHourlyStatus(`Hourly review is on · next check at ${nextText} · ${notificationStatus}.`);
  }

  async function toggleHourlyReview() {
    hourlyReviewEnabled = !hourlyReviewEnabled;
    if (hourlyReviewEnabled) {
      lastHourlyScanSlot = currentHourSlot();
      if ('Notification' in window && Notification.permission === 'default') {
        try {
          await Notification.requestPermission();
        } catch (error) {
          console.warn('TradePath could not request notification permission.', error);
        }
      }
    }
    saveHourlyPreference();
    updateHourlyControls();
  }

  function saveAudioAlertPreference() {
    if (!activeUser) return;
    activeUser.preferences.audioAlerts = hourlyToneEnabled;
    if (!saveUserPreferences()) {
      setHourlyStatus('Could not save your sound-alert preference on this device.');
      return;
    }
    if (hourlyToneEnabled) playHourlyTone();
  }

  function saveWatchlist(event) {
    event.preventDefault();
    const values = document.getElementById('watchSymbols').value.split(',').map(symbol => symbol.trim()).filter(Boolean);
    const normalized = [...new Set(values.map(symbol => symbol.toUpperCase()))];
    if (normalized.length > MAX_WATCH_SYMBOLS) {
      setHourlyStatus(`Choose no more than ${MAX_WATCH_SYMBOLS} symbols.`);
      return;
    }
    if (normalized.some(symbol => !/^[A-Z0-9._-]{1,32}$/u.test(symbol))) {
      setHourlyStatus('Symbols may contain letters, numbers, dots, underscores, and hyphens only.');
      return;
    }
    watchSymbols = normalized;
    activeUser.preferences.watchSymbols = [...watchSymbols];
    if (!saveUserPreferences()) {
      setHourlyStatus('Could not save the watchlist on this device.');
      return;
    }
    renderWatchlist();
    setHourlyStatus(`Saved ${watchSymbols.length} watched ${watchSymbols.length === 1 ? 'market' : 'markets'}.`);
  }

  function saveCoachPreferences(event) {
    event.preventDefault();
    if (!activeUser) return;
    activeUser.preferences.preferredStrategy = document.getElementById('preferredStrategy').value;
    activeUser.preferences.riskPercent = Number(document.getElementById('profileRiskPercent').value);
    if (!saveUserPreferences()) {
      setHourlyStatus('Could not save your learning preferences on this device.');
      return;
    }
    applyPreferences();
    setHourlyStatus('Your personal strategy focus and example risk setting are saved on this device.');
  }

  function checkHourlySchedule() {
    if (!hourlyReviewEnabled) return;
    const slot = currentHourSlot();
    if (lastHourlyScanSlot === null) {
      lastHourlyScanSlot = slot;
      saveHourlyPreference();
      updateHourlyControls();
      return;
    }
    if (slot > lastHourlyScanSlot) runHourlyReview(true);
  }

  async function pollMt5Status() {
    if (!activeUser) return;
    if (mt5PollInProgress) return;
    mt5PollInProgress = true;
    const refresh = document.getElementById('mt5Refresh');
    refresh.disabled = true;
    if (window.location.protocol !== 'http:' || window.location.hostname !== '127.0.0.1') {
      setMt5Status('error', 'Start the local bridge', 'Run node bridge.mjs, then open its local app link.');
      mt5PollInProgress = false;
      refresh.disabled = false;
      return;
    }
    try {
      const response = await fetch('/api/status', { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Local bridge returned HTTP ${response.status}.`);
      const status = await response.json();
      renderMt5Status(status);
    } catch (error) {
      setMt5Status('error', 'Local bridge unavailable', 'Run node bridge.mjs and open the app using its 127.0.0.1 link.');
      document.getElementById('mt5Explanation').textContent = error instanceof Error ? error.message : 'Could not read from the local bridge.';
    } finally {
      mt5PollInProgress = false;
      refresh.disabled = false;
    }
  }

  function getCurrentChartContext() {
    const badge = document.getElementById('mt5Badge').textContent;
    const connected = badge === 'MT4 chart connected' || badge === 'MT5 chart connected';
    if (!connected) {
      return 'I do not have a fresh chart report right now. Start node bridge.mjs, connect the MT4/MT5 TradePathMonitor, and check that its status says connected. I only review the most recently closed candles and never see your account or open orders.';
    }
    const symbol = document.getElementById('mt5Symbol').textContent;
    const timeframe = document.getElementById('mt5Timeframe').textContent;
    const price = document.getElementById('mt5Price').textContent;
    const trend = document.getElementById('trendAssessment').textContent;
    const levels = document.getElementById('levelsAssessment').textContent;
    const volatility = document.getElementById('volatilityAssessment').textContent;
    const preferenceNames = { compare: 'Compare all checklists', trend: 'Trend following', levels: 'Support and resistance', volatility: 'Volatility context' };
    const focus = activeUser ? ` Your saved study focus is ${preferenceNames[activeUser.preferences.preferredStrategy]}.` : '';
    const matches = Array.from(document.querySelectorAll('.strategy-match')).map(card => {
      const strategy = card.querySelector('span').textContent.split('/').slice(1).join('/').trim();
      const label = card.querySelector('strong').textContent;
      return `${strategy}: ${label}`;
    }).join('; ');
    return `Your latest ${symbol} ${timeframe} closed-candle report is connected at ${price}. ${trend} ${levels} ${volatility} Closest checklist observations: ${matches}.${focus} ${document.getElementById('mt5Explanation').textContent} This is descriptive education, not a buy/sell signal.`;
  }

  function getMarketWatchContext() {
    if (watchSymbols.length === 0) return 'Your market watchlist is empty. Add exact broker symbols in the hourly chart review section.';
    const summaries = watchSymbols.map(symbol => {
      const report = freshReportForSymbol(symbol);
      if (!report) return `${symbol}: no fresh chart feed`;
      const match = classifyReport(report);
      return `${symbol} (${report.platform}): ${match.label} — ${match.detail}`;
    });
    const preferenceNames = { compare: 'Compare all checklists', trend: 'Trend following', levels: 'Support and resistance', volatility: 'Volatility context' };
    const focus = activeUser ? ` Your saved study focus is ${preferenceNames[activeUser.preferences.preferredStrategy]}.` : '';
    return `Your watchlist contains ${watchSymbols.join(', ')}. Latest feed context: ${summaries.join('; ')}.${focus} The hourly review only runs while this app tab and the local bridge are open. These are checklist observations, not trade recommendations.`;
  }

  function answerMrT(question) {
    const text = question.toLowerCase().replace(/[’']/gu, '');
    if (/\b(hello|hi|hey|good morning|good evening)\b/u.test(text)) {
      return 'Hi, I’m Mr T—your trading study buddy. Ask me to explain a strategy, review the chart checklist, work through the example risk calculator, or help connect MT4/MT5.';
    }
    if (/\b(connect|connection|setup|bridge|expert advisor|ea|install)\b/u.test(text)) {
      return 'To connect: run node bridge.mjs in the TradePath folder and open its 127.0.0.1 link. In MetaTrader, allow http://127.0.0.1:8765 in Tools → Options → Expert Advisors. Compile and attach TradePathMonitor.mq4 for MT4 or .mq5 for MT5, then enter the token shown in the bridge terminal. The connection is read-only. See the README for full steps.';
    }
    if (/\b(best|should i|should we|buy|sell|enter|exit|trade now|right time|signal|guarantee|profit)\b/u.test(text)) {
      const aboutWatchedMarket = watchSymbols.some(symbol => text.includes(symbol.toLowerCase())) ||
        /\b(us30|ger40|dax|germany 40|uk100|us500|nas100|eurusd|gbpusd|usdjpy|xauusd)\b/u.test(text);
      const context = aboutWatchedMarket ? getMarketWatchContext() : getCurrentChartContext();
      return `I can’t tell you to buy, sell, enter, or exit, or claim a strategy is “best.” I can explain what the chart checklist observes: ${context}`;
    }
    if (/\b(hour|hourly|watchlist|watch list|us30|ger40|dax|germany 40|uk100|us500|nas100|eurusd|gbpusd|usdjpy|xauusd)\b/u.test(text)) {
      return getMarketWatchContext();
    }
    if (/\b(chart|market|current|right now|what do you see|what does it show|which strategy|strategy match|analy[sz]e)\b/u.test(text)) {
      return getCurrentChartContext();
    }
    if (/\b(trend|ema|moving average|following)\b/u.test(text)) {
      return 'Trend following studies whether price and trend measures are aligned. TradePath checks the latest close against EMA20, the EMA20 slope, and EMA20 versus EMA50. A match is historical context—not confirmation of an entry, and trends can reverse. Select the Trend following lesson to explore the checklist.';
    }
    if (/\b(support|resistance|level|range|breakout)\b/u.test(text)) {
      return 'Support and resistance are approximate areas where price reacted in the past—not precise barriers. TradePath marks the recent high/low area and checks whether the latest close is nearby. A touch does not confirm a reversal or breakout; price can move through the area.';
    }
    if (/\b(volatility|atr|range size|ranges)\b/u.test(text)) {
      return 'Volatility describes how much prices have been moving, not which direction they will go. TradePath compares recent candle ranges with an earlier baseline to label expansion, quieter conditions, or a typical range. This simple check does not predict a breakout.';
    }
    if (/\b(risk|position size|position sizing|stop|loss|calculator|account)\b/u.test(text)) {
      const account = Number(document.getElementById('accountSize').value);
      const riskPercent = Number(document.getElementById('riskPercent').value);
      const entry = Number(document.getElementById('entryPrice').value);
      const stop = Number(document.getElementById('stopPrice').value);
      if (account > 0 && entry > 0 && stop > 0 && entry !== stop) {
        const budget = account * riskPercent / 100;
        const units = Math.floor(budget / Math.abs(entry - stop));
          return `The example calculator currently uses $${account.toLocaleString()} and ${riskPercent}% planned risk, or $${budget.toFixed(2)}. With an entry of ${entry} and stop of ${stop}, its illustrative result is ${units} units before costs. The displayed account is just an example, not connected to your broker. Fees, leverage, gaps, and slippage may change losses.`;
      }
      return 'Position size is based on a pre-set hypothetical risk budget divided by the distance from entry to the invalidation/stop—not on confidence. Try the Risk first calculator in Practice; it uses example inputs only and does not see your account.';
    }
    if (/\b(ai|artificial intelligence|how do you work|who are you|are you real)\b/u.test(text)) {
      return 'I’m Mr T, a small local rule-based learning chatbot. I use the lessons and the latest chart checklist shown in this app; I’m not a generative AI model or a live-market prediction service. Your messages stay in this browser.';
    }
    if (/\b(thank|thanks|help|lesson|learn|strategy|strategies)\b/u.test(text)) {
      return 'Happy to help you learn. We can explore trend following, support and resistance, volatility, the example position-size calculator, or connecting MT4/MT5. Try one of the suggested questions below. I can explain a checklist, but I can’t recommend or place a trade.';
    }
    if (/\b(mt4|mt5|metatrader)\b/u.test(text)) {
      return 'TradePath supports read-only chart data from MT4 or MT5. If you have attached the TradePathMonitor Expert Advisor, ask “What does my chart show?” to review the latest closed-candle checklist. Ask “How do I connect MT4?” for setup instructions.';
    }
    return 'I’m not sure I understood that. Try asking about your chart context, trend following, support and resistance, volatility, position sizing, or how to connect MT4/MT5. I can explain concepts, not recommend trades.';
  }

  function appendMrTMessage(text, sender) {
    const log = document.getElementById('mrTMessages');
    const message = document.createElement('div');
    message.className = `mr-t-message mr-t-message-${sender}`;
    message.textContent = text;
    log.append(message);
    while (log.children.length > 40) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
    return message;
  }

  function appendMrTResponse(response, citations = []) {
    const message = appendMrTMessage(response, 'bot');
    const validCitations = citations.filter(citation => {
      try {
        const url = new URL(citation.url);
        return url.protocol === 'https:' || url.protocol === 'http:';
      } catch {
        return false;
      }
    });
    if (validCitations.length) {
      const list = document.createElement('ul');
      list.className = 'mr-t-citations';
      validCitations.forEach(citation => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = citation.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = citation.title || new URL(citation.url).hostname;
        item.append(link);
        list.append(item);
      });
      message.append(list);
    }
  }

  async function sendMrTQuestion(question) {
    const trimmed = question.trim();
    if (!trimmed) return;
    appendMrTMessage(trimmed, 'user');
    const provider = document.getElementById('mrTProvider').value;
    if (provider === 'local') {
      appendMrTMessage(answerMrT(trimmed), 'bot');
      return;
    }
    const sendButton = document.querySelector('#mrTForm button[type="submit"]');
    sendButton.disabled = true;
    const searchingMessage = appendMrTMessage('Searching the web and preparing an educational answer…', 'bot');
    try {
      const response = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ provider, question: trimmed })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `The AI request failed (${response.status}).`);
      searchingMessage.remove();
      appendMrTResponse(result.text, result.citations);
    } catch (error) {
      console.error('TradePath could not complete the external Mr T request.', error);
      searchingMessage.textContent = error.message || 'The external AI service could not answer. Check the bridge and provider configuration, then try again.';
    } finally {
      sendButton.disabled = false;
    }
  }

  async function refreshAiProviders() {
    const provider = document.getElementById('mrTProvider');
    const privacy = document.getElementById('mrTPrivacy');
    const geminiOption = provider.querySelector('option[value="gemini"]');
    const claudeOption = provider.querySelector('option[value="claude"]');
    try {
      const response = await fetch('/api/ai/status', { cache: 'no-store' });
      if (!response.ok) throw new Error(`AI service status returned ${response.status}.`);
      const result = await response.json();
      geminiOption.disabled = !result.providers?.gemini;
      geminiOption.textContent = result.providers?.gemini
        ? 'Google Gemini · Google Search'
        : 'Google Gemini · Google Search (set GEMINI_API_KEY on server)';
      claudeOption.disabled = !result.providers?.claude;
      claudeOption.textContent = result.providers?.claude
        ? 'Claude · web search'
        : 'Claude · web search (set ANTHROPIC_API_KEY on server)';
    } catch (error) {
      console.warn('TradePath could not check external AI availability.', error);
      geminiOption.disabled = true;
      claudeOption.disabled = true;
      privacy.textContent = 'External AI is not configured for this site yet. Local questions stay in this browser; hosted AI needs its server-side provider configuration.';
    }
  }

  function setMrTChatOpen(open) {
    const panel = document.getElementById('mrTPanel');
    const launcher = document.getElementById('mrTLauncher');
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    if (open) document.getElementById('mrTInput').focus();
    else launcher.focus();
  }

  function renderLessons() {
    const grid = document.getElementById('lessonGrid');
    lessons.forEach(lesson => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lesson-card';
      button.dataset.lesson = lesson.id;
      button.setAttribute('aria-expanded', 'false');
      button.innerHTML = `<span class="lesson-number">${lesson.number} / STRATEGY</span><span class="lesson-symbol" aria-hidden="true">${lesson.symbol}</span><h3>${lesson.title}</h3><p>${lesson.description}</p><span class="lesson-link">Explore this strategy →</span>`;
      button.addEventListener('click', () => selectLesson(lesson.id));
      grid.append(button);
    });
  }

  function selectLesson(id) {
    const lesson = lessons.find(item => item.id === id);
    if (!lesson) return;
    document.querySelectorAll('.lesson-card').forEach(button => {
      button.setAttribute('aria-expanded', String(button.dataset.lesson === id));
    });
    document.getElementById('lessonDetail').innerHTML = `
      <div class="detail-content">
        <div><p class="card-label">THE IDEA</p><h3>${lesson.title}</h3><p>${lesson.overview}</p></div>
        <ol class="detail-steps">${lesson.steps.map((step, index) => `<li><span>0${index + 1}</span>${step}</li>`).join('')}</ol>
        <p class="lesson-caution">Keep in mind: ${lesson.caution}</p>
      </div>`;
    if (!state.explored.includes(id)) {
      state.explored.push(id);
      saveProgress();
    }
  }

  function makeChart(points, id) {
    const coords = points.map((point, index) => `${index * 36 + 20},${110 - point}`).join(' ');
    const area = `20,110 ${coords} ${points.length * 36 + 20},110`;
    return `<svg viewBox="0 0 400 112" preserveAspectRatio="none" role="img" aria-label="Illustrative, simulated price movement">
      <defs><linearGradient id="chartFill${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#6f9a77" stop-opacity=".2"/><stop offset="100%" stop-color="#6f9a77" stop-opacity="0"/></linearGradient></defs>
      <path d="M${area.replaceAll(' ', ' L')} Z" fill="url(#chartFill${id})"/>
      <polyline points="${coords}" fill="none" stroke="#598263" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <line x1="0" y1="106" x2="400" y2="106" stroke="#e6ebe4" stroke-width="1" vector-effect="non-scaling-stroke"/>
      <line x1="0" y1="56" x2="400" y2="56" stroke="#edf0eb" stroke-width="1" stroke-dasharray="3 5" vector-effect="non-scaling-stroke"/>
    </svg>`;
  }

  function renderScenario() {
    const scenario = scenarios[activeScenario];
    document.getElementById('scenarioCount').textContent = `SCENARIO 0${activeScenario + 1} / 03`;
    document.getElementById('scenarioTitle').textContent = scenario.title;
    document.getElementById('scenarioDescription').textContent = scenario.description;
    document.getElementById('scenarioContext').textContent = scenario.context;
    document.getElementById('scenarioFocus').textContent = scenario.focus;
    document.getElementById('scenarioChart').innerHTML = makeChart(scenario.points, activeScenario);
    document.getElementById('scenarioFeedback').hidden = true;
    document.getElementById('scenarioFeedback').removeAttribute('data-tone');
    document.getElementById('nextScenario').hidden = true;
    scenarioAnswered = false;
    const choices = activeScenario === 0
      ? ['Enter immediately', 'Wait for my setup', 'Increase the position']
      : activeScenario === 1
        ? ['Assume it will reverse', 'Wait for a reaction', 'Ignore the level']
        : ['Increase my risk limit', 'Ignore the stop', 'Reduce size or skip']
    ;
    const choiceContainer = document.getElementById('scenarioChoices');
    choiceContainer.replaceChildren();
    choices.forEach(choice => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'choice-button';
      button.textContent = choice;
      button.addEventListener('click', () => chooseScenario(choice));
      choiceContainer.append(button);
    });
  }

  function chooseScenario(choice) {
    if (scenarioAnswered) return;
    scenarioAnswered = true;
    const scenario = scenarios[activeScenario];
    const matches = choice === scenario.answer;
    const feedback = document.getElementById('scenarioFeedback');
    feedback.dataset.tone = matches ? 'good' : 'caution';
    feedback.innerHTML = `<strong>${matches ? 'Thoughtful choice.' : 'Consider the plan first.'}</strong>${scenario.feedback}`;
    feedback.hidden = false;
    document.querySelectorAll('.choice-button').forEach(button => { button.disabled = true; });
    state.scenarios += 1;
    saveProgress();
    document.getElementById('nextScenario').hidden = false;
  }

  function nextScenario() {
    activeScenario = (activeScenario + 1) % scenarios.length;
    renderScenario();
  }

  function initializeInstallExperience() {
    const buttons = Array.from(document.querySelectorAll('.install-app-button'));
    const status = document.getElementById('installAppStatus');
    let installPrompt = null;
    const isInstalled = () =>
      window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const isSecureOrigin = window.isSecureContext;
    const isAppleMobile = /iPhone|iPad|iPod/u.test(window.navigator.userAgent) ||
      (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
    const isSafari = /Safari/u.test(window.navigator.userAgent) &&
      !/(CriOS|FxiOS|EdgiOS|OPiOS)/u.test(window.navigator.userAgent);

    const setButtonsHidden = hidden => buttons.forEach(button => { button.hidden = hidden; });
    setButtonsHidden(isInstalled() || (!isAppleMobile && !installPrompt));
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      installPrompt = event;
      buttons.forEach(button => { button.textContent = 'Install app'; });
      setButtonsHidden(isInstalled());
    });
    window.addEventListener('appinstalled', () => {
      installPrompt = null;
      setButtonsHidden(true);
      status.textContent = 'TradePath was added to your home screen.';
    });
    buttons.forEach(button => button.addEventListener('click', async () => {
      if (!isSecureOrigin) {
        status.textContent = 'To install TradePath on your phone, open its hosted HTTPS link. The file or local computer link cannot be installed on your phone.';
        return;
      }
      if (!('serviceWorker' in navigator)) {
        status.textContent = 'This browser does not support installing web apps. Try the latest Chrome or Safari.';
        return;
      }
      if (installPrompt) {
        installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        installPrompt = null;
        if (choice.outcome === 'accepted') {
          status.textContent = 'TradePath is being added to your home screen.';
        } else {
          status.textContent = 'Installation was cancelled. You can try again from your browser menu.';
        }
        return;
      }
      status.textContent = isAppleMobile && isSafari
        ? 'In Safari, tap Share, then Add to Home Screen. Push notifications on iPhone/iPad require iOS/iPadOS 16.4 or later and the installed home-screen app.'
        : 'Open your browser menu and choose Install app or Add to Home screen.';
    }));

    if (!isSecureOrigin || !('serviceWorker' in navigator)) {
      setButtonsHidden(false);
      return;
    }
    navigator.serviceWorker.register('/sw.js')
      .then(() => { setButtonsHidden(isInstalled()); })
      .catch(error => {
        console.error('TradePath could not register its offline app support.', error);
        status.textContent = 'App installation is unavailable right now. Open TradePath from its HTTPS-hosted link and try again.';
        setButtonsHidden(false);
      });
  }

  function updateRisk() {
    const account = Number(document.getElementById('accountSize').value);
    const riskPercent = Number(document.getElementById('riskPercent').value);
    const entry = Number(document.getElementById('entryPrice').value);
    const stop = Number(document.getElementById('stopPrice').value);
    document.getElementById('riskPercentOutput').textContent = `${riskPercent}%`;
    const size = document.getElementById('positionSize');
    const explanation = document.getElementById('riskExplanation');
    const inputsValid = Number.isFinite(account) && account > 0 && Number.isFinite(riskPercent) &&
      Number.isFinite(entry) && Number.isFinite(stop) && entry > 0 && stop > 0 && entry !== stop;
    if (!inputsValid) {
      size.textContent = 'Check your inputs';
      explanation.textContent = 'Enter positive prices that differ, and a valid account size.';
      return;
    }
    const riskBudget = account * riskPercent / 100;
    const distance = Math.abs(entry - stop);
    const units = Math.floor(riskBudget / distance);
    if (!Number.isFinite(units) || units < 1) {
      size.textContent = 'Less than 1 unit';
      explanation.textContent = `A ${formatMoney(riskBudget)} risk budget is smaller than the ${formatMoney(distance)} per-unit stop distance.`;
      return;
    }
    size.textContent = `${units.toLocaleString()} ${units === 1 ? 'unit' : 'units'}`;
    explanation.textContent = `At ${formatMoney(distance)} risk per unit, the planned loss is about ${formatMoney(units * distance)} (${formatMoney(riskBudget)} budget).`;
  }

  function formatMoney(value) {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
  }

  function renderQuestion() {
    const question = questions[activeQuestion];
    questionAnswered = false;
    document.getElementById('quizQuestionNumber').textContent = `QUESTION 0${activeQuestion + 1} / 03`;
    document.getElementById('quizProgressBar').style.width = `${activeQuestion / questions.length * 100}%`;
    document.getElementById('quizQuestion').textContent = question.prompt;
    document.getElementById('quizResult').textContent = '';
    document.getElementById('quizResult').removeAttribute('data-tone');
    const options = document.getElementById('quizOptions');
    options.replaceChildren();
    question.options.forEach((option, index) => {
      const label = document.createElement('label');
      label.className = 'quiz-option';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'answer';
      input.value = String(index);
      input.required = true;
      const text = document.createElement('span');
      text.textContent = option;
      label.append(input, text);
      options.append(label);
    });
    const submit = document.querySelector('.quiz-submit');
    submit.hidden = false;
    submit.innerHTML = 'Check answer <span aria-hidden="true">→</span>';
    submit.disabled = false;
  }

  function submitAnswer(event) {
    event.preventDefault();
    if (questionAnswered) {
      if (activeQuestion + 1 < questions.length) {
        activeQuestion += 1;
        renderQuestion();
      } else {
        finishQuiz();
      }
      return;
    }
    const selected = document.querySelector('input[name="answer"]:checked');
    if (!selected) {
      document.getElementById('quizResult').textContent = 'Choose an answer to continue.';
      document.getElementById('quizResult').dataset.tone = 'caution';
      return;
    }
    questionAnswered = true;
    const question = questions[activeQuestion];
    const correct = Number(selected.value) === question.answer;
    if (correct) quizScore += 1;
    const result = document.getElementById('quizResult');
    result.textContent = `${correct ? 'That’s right. ' : 'Not quite. '}${question.explanation}`;
    result.dataset.tone = correct ? 'good' : 'caution';
    document.querySelectorAll('input[name="answer"]').forEach(input => { input.disabled = true; });
    const submit = document.querySelector('.quiz-submit');
    submit.innerHTML = activeQuestion + 1 < questions.length
      ? 'Next question <span aria-hidden="true">→</span>'
      : 'See my recap <span aria-hidden="true">→</span>';
  }

  function finishQuiz() {
    state.quizDone = true;
    saveProgress();
    const card = document.querySelector('.quiz-card');
    const result = quizScore === questions.length
      ? 'Great recall. Keep practicing the process—not chasing a perfect score.'
      : 'You’ve taken a useful first step. Review any answer you missed and keep learning at your own pace.';
    card.innerHTML = `<div class="quiz-complete"><span class="eyebrow">QUICK CHECK COMPLETE</span><strong>${quizScore} / ${questions.length} correct</strong><p>${result}</p><button class="quiz-restart" type="button">Practice the questions again →</button></div>`;
    card.querySelector('.quiz-restart').addEventListener('click', () => {
      activeQuestion = 0;
      quizScore = 0;
      const freshCard = document.createElement('div');
      freshCard.className = 'quiz-card';
      freshCard.innerHTML = '<div class="quiz-card-head"><span id="quizQuestionNumber"></span><span class="quiz-tag">QUICK CHECK</span></div><div class="quiz-progress-track"><span id="quizProgressBar"></span></div><form id="quizForm"><fieldset><legend id="quizQuestion"></legend><div class="quiz-options" id="quizOptions"></div></fieldset><div class="quiz-result" id="quizResult" aria-live="polite"></div><button class="button button-dark quiz-submit" type="submit">Check answer <span aria-hidden="true">→</span></button></form>';
      card.replaceWith(freshCard);
      freshCard.querySelector('#quizForm').addEventListener('submit', submitAnswer);
      renderQuestion();
    });
  }

  function renderJournal() {
    const container = document.getElementById('journalEntries');
    container.replaceChildren();
    document.getElementById('journalEntryLabel').textContent = `${state.journal.length} ${state.journal.length === 1 ? 'entry' : 'entries'}`;
    if (state.journal.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'journal-empty';
      empty.textContent = 'Your reflections will appear here on this device.';
      container.append(empty);
      return;
    }
    state.journal.forEach(entry => {
      const article = document.createElement('article');
      article.className = 'journal-entry';
      const meta = document.createElement('div');
      meta.className = 'journal-entry-meta';
      const strategy = document.createElement('span');
      strategy.textContent = entry.strategy;
      const date = document.createElement('time');
      date.dateTime = entry.date;
      date.textContent = `${entry.date} · ${entry.emotion}`;
      meta.append(strategy, date);
      const note = document.createElement('p');
      note.textContent = entry.notes;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'journal-delete';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove journal entry about ${entry.strategy}`);
      remove.addEventListener('click', () => {
        state.journal = state.journal.filter(item => item.id !== entry.id);
        saveProgress();
        renderJournal();
      });
      article.append(meta, note, remove);
      container.append(article);
    });
  }

  function addJournalEntry(event) {
    event.preventDefault();
    const strategy = document.getElementById('journalStrategy').value;
    const emotion = document.getElementById('journalEmotion').value;
    const notes = document.getElementById('journalNotes').value.trim();
    if (!strategy || !emotion || !notes) return;
    state.journal.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      strategy,
      emotion,
      notes,
      date: new Date().toISOString().slice(0, 10)
    });
    state.journal = state.journal.slice(0, 20);
    saveProgress();
    renderJournal();
    document.getElementById('journalForm').reset();
    document.getElementById('journalMessage').textContent = 'Reflection saved on this device.';
    window.setTimeout(() => { document.getElementById('journalMessage').textContent = ''; }, 3500);
  }

  renderLessons();
  renderScenario();
  renderProgress();
  renderJournal();
  renderQuestion();
  document.getElementById('nextScenario').addEventListener('click', nextScenario);
  document.getElementById('riskForm').addEventListener('input', updateRisk);
  document.getElementById('quizForm').addEventListener('submit', submitAnswer);
  document.getElementById('journalForm').addEventListener('submit', addJournalEntry);
  document.getElementById('mt5Refresh').addEventListener('click', pollMt5Status);
  document.getElementById('watchlistForm').addEventListener('submit', saveWatchlist);
  document.getElementById('coachPreferencesForm').addEventListener('submit', saveCoachPreferences);
  document.getElementById('hourlyToggle').addEventListener('click', toggleHourlyReview);
  document.getElementById('hourlyScanNow').addEventListener('click', () => runHourlyReview(true));
  document.getElementById('hourlyToneEnabled').addEventListener('change', event => {
    hourlyToneEnabled = event.target.checked;
    saveAudioAlertPreference();
  });
  document.getElementById('testHourlyTone').addEventListener('click', playHourlyTone);
  renderWatchlist();
  updateHourlyControls();
  appendMrTMessage('Hi, I’m Mr T. Ask me about a strategy, your latest chart checklist, risk basics, or connecting MT4/MT5. I can help explain—not make trading decisions for you.', 'bot');
  document.getElementById('mrTLauncher').addEventListener('click', () => {
    setMrTChatOpen(document.getElementById('mrTPanel').hidden);
  });
  document.getElementById('mrTClose').addEventListener('click', () => setMrTChatOpen(false));
  document.getElementById('mrTForm').addEventListener('submit', event => {
    event.preventDefault();
    const input = document.getElementById('mrTInput');
    void sendMrTQuestion(input.value);
    input.value = '';
    input.focus();
  });
  document.getElementById('mrTSuggestions').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button) void sendMrTQuestion(button.textContent);
  });
  document.getElementById('mrTProvider').addEventListener('change', event => {
    const privacy = document.getElementById('mrTPrivacy');
    privacy.textContent = event.target.value === 'local'
      ? 'Local questions stay in this browser. Choosing an external provider sends only your typed question to Google or Anthropic; chart data, watchlist, and profile are not included. Provider usage may incur charges.'
      : 'This question will be sent to the selected provider for a web-grounded answer. Chart data, watchlist, and profile are not included. Provider usage may incur charges.';
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.getElementById('mrTPanel').hidden) setMrTChatOpen(false);
  });
  updateRisk();
  initializeInstallExperience();
  initializeLocalAuth();
  void refreshAiProviders();
  window.setInterval(pollMt5Status, 3000);
  window.setInterval(checkHourlySchedule, 15000);
})();
