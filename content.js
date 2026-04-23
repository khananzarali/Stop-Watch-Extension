// Constants
const STORAGE_KEYS = {
    STOPWATCH: 'stopwatch',
    WIDGET_POSITION: 'widget_position',
    POMODORO: 'pomodoro',
    ALARM: 'alarm'
};

const DEFAULT_STOPWATCH = { isRunning: false, startTime: null, elapsedTime: 0 };
const DEFAULT_POMODORO = {
    isRunning: false,
    isWorkTime: true,
    timeLeft: 25 * 60,
    totalTime: 25 * 60,
    workDuration: 25 * 60,
    breakDuration: 5 * 60,
    autoStart: false,
    cycleCount: 0
};

const DEFAULT_ALARM = {
    alarms: [],
    isActive: false
};

let localTimer = null;
let pomodoroTimer = null;
let alarmCheckTimer = null;
let lapCount = 0;
let widgetInstance = null;
let mutationObserver = null;
let isDragging = false;
let hasMoved = false;
let startMouseX, startMouseY;
let initialWidgetX, initialWidgetY;

// Safe storage operations with error handling
function safeStorageGet(keys, callback) {
    chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime.lastError) {
            console.error('Storage get error:', chrome.runtime.lastError);
            callback({});
        } else {
            callback(result);
        }
    });
}

function safeStorageSet(items) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set(items, () => {
            if (chrome.runtime.lastError) {
                console.error('Storage set error:', chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
            } else {
                resolve();
            }
        });
    });
}

function safeStorageRemove(keys) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.remove(keys, () => {
            if (chrome.runtime.lastError) {
                console.error('Storage remove error:', chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
            } else {
                resolve();
            }
        });
    });
}

function initApp() {
    if (widgetInstance) return;

    if (!document.body) {
        requestAnimationFrame(initApp);
        return;
    }

    widgetInstance = buildWidget();
    document.body.appendChild(widgetInstance);

    setupTabSwitching();
    setupStopwatch();
    setupPomodoro();
    setupAlarm();
    setupDragAndDrop();

    loadWidgetPosition();

    // Watch for DOM changes to re-initialize if needed (for SPAs)
    mutationObserver = new MutationObserver(() => {
        if (!document.getElementById('ext-global-watch') && document.body) {
            cleanup();
            widgetInstance = null;
            initApp();
        }
    });

    mutationObserver.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
    });
}

function buildWidget() {
    const widget = document.createElement('div');
    widget.id = 'ext-global-watch';
    widget.setAttribute('role', 'button');
    widget.setAttribute('aria-label', 'Productivity Watch widget');
    widget.setAttribute('tabindex', '0');

    widget.innerHTML = `
        <div id="watch-icon" role="button" aria-label="Toggle watch panel" tabindex="0">⏱️</div>
        <div id="watch-panel" style="display:none;" role="dialog" aria-label="Watch controls">
            <div id="watch-tabs" role="tablist">
                <span class="active" data-target="panel-watch" role="tab" aria-selected="true" tabindex="0">Watch</span>
                <span data-target="panel-pomo" role="tab" aria-selected="false" tabindex="0">Pomo</span>
                <span data-target="panel-alarm" role="tab" aria-selected="false" tabindex="0">Alarm</span>
            </div>

            <div id="panel-watch" class="watch-view" role="tabpanel">
                <div id="sw-display" aria-live="polite">00:00:00</div>
                <div id="sw-controls">
                    <button id="sw-start" aria-label="Start or pause stopwatch">Start</button>
                    <button id="sw-reset" aria-label="Reset stopwatch">Reset</button>
                    <button id="sw-lap" aria-label="Record lap time">Lap</button>
                </div>
                <div id="sw-laps" aria-label="Lap times"></div>
            </div>

            <div id="panel-pomo" class="watch-view" style="display:none;" role="tabpanel">
                <div id="pomo-display" aria-live="polite">25:00</div>
                <div id="pomo-controls">
                    <button id="pomo-start" style="background:#3498db;" aria-label="Start or pause pomodoro">Start</button>
                    <button id="pomo-reset" style="background:#e67e22;" aria-label="Reset pomodoro">Reset</button>
                    <button id="pomo-settings" style="background:#9b59b6;" aria-label="Timer settings">⚙️</button>
                </div>
                <div id="pomo-timer-settings" class="pomo-settings">
                    <div class="pomo-setting">
                        <label>Work (min)</label>
                        <input type="number" id="pomo-work-min" min="1" max="60" value="25">
                    </div>
                    <div class="pomo-setting">
                        <label>Break (min)</label>
                        <input type="number" id="pomo-break-min" min="1" max="30" value="5">
                    </div>
                    <div class="pomo-setting">
                        <label>Auto-start</label>
                        <input type="checkbox" id="pomo-auto-start">
                    </div>
                </div>
                <div id="pomo-status" class="pomo-status" aria-live="polite"></div>
            </div>

            <div id="panel-alarm" class="watch-view" style="display:none;" role="tabpanel">
                <div id="alarm-settings">
                    <div class="alarm-setting">
                        <label>Alarm Time</label>
                        <div class="alarm-time-inputs">
                            <input type="number" id="alarm-hour" min="0" max="23" value="07" placeholder="HH">
                            <span class="alarm-input-separator">:</span>
                            <input type="number" id="alarm-minute" min="0" max="59" value="00" placeholder="MM">
                        </div>
                    </div>
                    <div class="alarm-setting">
                        <label>Repeat</label>
                        <select id="alarm-repeat" style="width:100%; padding:6px;background:#1a1a1a;color:white;border:1px solid #555;border-radius:4px;">
                            <option value="once">Once</option>
                            <option value="daily">Daily</option>
                            <option value="weekdays">Weekdays</option>
                        </select>
                    </div>
                </div>
                <div id="alarm-controls">
                    <button id="alarm-set" aria-label="Set alarm">Set Alarm</button>
                    <button id="alarm-clear" aria-label="Clear alarm">Clear</button>
                </div>
                <div id="alarm-status" class="alarm-status inactive" aria-live="polite">No alarm set</div>
                <div id="alarm-list" class="alarm-time-list"></div>
            </div>
        </div>
    `;

    return widget;
}

function setupTabSwitching() {
    const tabs = document.querySelectorAll('#watch-tabs span');
    const views = document.querySelectorAll('.watch-view');
    const settingsBtn = document.getElementById('pomo-settings');
    const settingsPanel = document.getElementById('pomo-timer-settings');

    tabs.forEach((tab, index) => {
        tab.addEventListener('click', (e) => {
            switchTab(tabs, views, e.target);
        });
        tab.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                switchTab(tabs, views, e.target);
            }
        });
    });

    if (settingsBtn) {
        settingsBtn.addEventListener('click', togglePomoSettings);
        settingsBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                togglePomoSettings();
            }
        });
    }
}

function switchTab(tabs, views, targetTab) {
    tabs.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
    });
    views.forEach(v => v.style.display = 'none');

    targetTab.classList.add('active');
    targetTab.setAttribute('aria-selected', 'true');
    document.getElementById(targetTab.getAttribute('data-target')).style.display = 'block';
}

function setupStopwatch() {
    const defaultState = DEFAULT_STOPWATCH;

    loadAndSyncStopwatch();

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.stopwatch) {
            syncStopwatchVisuals(changes.stopwatch.newValue || defaultState);
        }
    });

    document.getElementById('sw-start').addEventListener('click', toggleStopwatch);
    document.getElementById('sw-reset').addEventListener('click', resetStopwatch);
    document.getElementById('sw-lap').addEventListener('click', recordLap);
}

function loadAndSyncStopwatch() {
    safeStorageGet([STORAGE_KEYS.STOPWATCH], (result) => {
        const state = result.stopwatch || DEFAULT_STOPWATCH;
        syncStopwatchVisuals(state);
        updateStopwatchDisplay(state);
    });
}

function toggleStopwatch() {
    safeStorageGet([STORAGE_KEYS.STOPWATCH], (result) => {
        const state = result.stopwatch || { ...DEFAULT_STOPWATCH };

        if (!state.isRunning) {
            state.isRunning = true;
            state.startTime = Date.now();
        } else {
            state.isRunning = false;
            state.elapsedTime += Date.now() - state.startTime;
            state.startTime = null;
        }

        safeStorageSet({ stopwatch: state }).catch(console.error);
    });
}

function resetStopwatch() {
    safeStorageSet({ stopwatch: DEFAULT_STOPWATCH }).catch(console.error);
    lapCount = 0;
    const lapsContainer = document.getElementById('sw-laps');
    if (lapsContainer) lapsContainer.innerHTML = '';
}

function recordLap() {
    const display = document.getElementById('sw-display');
    const currentTime = display ? display.innerText : '00:00:00';

    if (currentTime === '00:00:00') return;

    lapCount++;
    const lapContainer = document.getElementById('sw-laps');
    if (!lapContainer) return;

    const lapElement = document.createElement('div');
    lapElement.className = 'lap-item';
    lapElement.innerHTML = `
        <span class="lap-number">Lap ${lapCount}</span>
        <span class="lap-time">${currentTime}</span>
    `;
    lapContainer.prepend(lapElement);
}

function syncStopwatchVisuals(state) {
    clearInterval(localTimer);
    const btn = document.getElementById('sw-start');

    if (!btn) return;

    if (state.isRunning) {
        btn.innerText = 'Pause';
        btn.style.background = '#e74c3c';
        localTimer = setInterval(() => updateStopwatchDisplay(state), 100);
    } else {
        btn.innerText = 'Start';
        btn.style.background = '#2ecc71';
        clearInterval(localTimer);
        updateStopwatchDisplay(state);
    }
}

function updateStopwatchDisplay(state) {
    let totalMs = state.elapsedTime;
    if (state.isRunning && state.startTime) {
        totalMs += (Date.now() - state.startTime);
    }

    const totalSeconds = Math.floor(totalMs / 1000);
    const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');

    const display = document.getElementById('sw-display');
    if (display) display.innerText = `${h}:${m}:${s}`;
}

function setupPomodoro() {
    loadAndSyncPomodoro();

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.pomodoro) {
            syncPomodoroVisuals(changes.pomodoro.newValue || DEFAULT_POMODORO);
        }
    });

    document.getElementById('pomo-start').addEventListener('click', togglePomodoro);
    document.getElementById('pomo-reset').addEventListener('click', resetPomodoro);

    const workInput = document.getElementById('pomo-work-min');
    const breakInput = document.getElementById('pomo-break-min');
    const autoStartInput = document.getElementById('pomo-auto-start');

    if (workInput) workInput.addEventListener('change', updatePomodoroSettings);
    if (breakInput) breakInput.addEventListener('change', updatePomodoroSettings);
    if (autoStartInput) autoStartInput.addEventListener('change', updatePomodoroSettings);
}

function startPomodoroCountdown(state) {
    pomodoroTimer = setInterval(() => {
        safeStorageGet([STORAGE_KEYS.POMODORO], (result) => {
            const current = result.pomodoro || DEFAULT_POMODORO;

            if (!current.isRunning) {
                clearInterval(pomodoroTimer);
                return;
            }

            current.timeLeft--;

            if (current.timeLeft < 0) {
                clearInterval(pomodoroTimer);
                handlePomodoroComplete(current);
                return;
            }

            updatePomodoroDisplay(current);
        safeStorageSet({ pomodoro: current }).catch(console.error);
    });
}, 1000);
}


function setupAlarm() {
    loadAndSyncAlarm();

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.alarm) {
            const newState = changes.alarm.newValue || DEFAULT_ALARM;
            syncAlarmVisuals(newState);
            renderAlarmList(newState);
        }
    });

    const setBtn = document.getElementById('alarm-set');
    const clearBtn = document.getElementById('alarm-clear');

    if (setBtn) setBtn.addEventListener('click', setAlarm);
    if (clearBtn) clearBtn.addEventListener('click', clearAllAlarms);

    startAlarmChecker();
}

function loadAndSyncAlarm() {
    safeStorageGet([STORAGE_KEYS.ALARM], (result) => {
        const state = result.alarm || DEFAULT_ALARM;
        syncAlarmVisuals(state);
        renderAlarmList(state);
    });
}

function loadAndSyncPomodoro() {
    safeStorageGet([STORAGE_KEYS.POMODORO], (result) => {
        const state = result.pomodoro || { ...DEFAULT_POMODORO };
        syncPomodoroVisuals(state);

        const workInput = document.getElementById('pomo-work-min');
        const breakInput = document.getElementById('pomo-break-min');
        const autoStartInput = document.getElementById('pomo-auto-start');

        if (workInput) workInput.value = Math.floor(state.workDuration / 60);
        if (breakInput) breakInput.value = Math.floor(state.breakDuration / 60);
        if (autoStartInput) autoStartInput.checked = state.autoStart;
    });
}



function updatePomodoroSettings() {
    const workInput = document.getElementById('pomo-work-min');
    const breakInput = document.getElementById('pomo-break-min');
    const autoStartInput = document.getElementById('pomo-auto-start');

    if (!workInput || !breakInput || !autoStartInput) return;

    const workMinutes = parseInt(workInput.value) || 25;
    const breakMinutes = parseInt(breakInput.value) || 5;

    safeStorageGet([STORAGE_KEYS.POMODORO], (result) => {
        const state = result.pomodoro || { ...DEFAULT_POMODORO };
        state.workDuration = workMinutes * 60;
        state.breakDuration = breakMinutes * 60;
        state.autoStart = autoStartInput.checked;

        if (!state.isRunning && state.isWorkTime) {
            state.timeLeft = state.workDuration;
            state.totalTime = state.workDuration;
        } else if (!state.isRunning && !state.isWorkTime) {
            state.timeLeft = state.breakDuration;
            state.totalTime = state.breakDuration;
        }

        safeStorageSet({ pomodoro: state }).catch(console.error);
    });
}

function togglePomodoro() {
    safeStorageGet([STORAGE_KEYS.POMODORO], (result) => {
        const state = result.pomodoro || { ...DEFAULT_POMODORO };

        if (!state.isRunning) {
            state.isRunning = true;
        } else {
            state.isRunning = false;
        }

        safeStorageSet({ pomodoro: state }).catch(console.error);
    });
}

function resetPomodoro() {
    clearInterval(pomodoroTimer);
    safeStorageGet([STORAGE_KEYS.POMODORO], (result) => {
        const state = result.pomodoro || { ...DEFAULT_POMODORO };
        state.isRunning = false;
        state.isWorkTime = true;
        state.timeLeft = state.workDuration;
        state.totalTime = state.workDuration;
        state.cycleCount = 0;
        safeStorageSet({ pomodoro: state }).catch(console.error);
    });
}

function setAlarm() {
    const hourInput = document.getElementById('alarm-hour');
    const minuteInput = document.getElementById('alarm-minute');
    const repeatSelect = document.getElementById('alarm-repeat');

    if (!hourInput || !minuteInput) return;

    const hour = parseInt(hourInput.value) || 0;
    const minute = parseInt(minuteInput.value) || 0;
    const repeat = repeatSelect ? repeatSelect.value : 'once';

    // Validate
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        alert('Please enter a valid time');
        return;
    }

    safeStorageGet([STORAGE_KEYS.ALARM], (result) => {
        const alarmState = result.alarm || { ...DEFAULT_ALARM };

        const newAlarm = {
            id: Date.now(),
            hour,
            minute,
            repeat,
            active: true,
            createdAt: Date.now()
        };

        alarmState.alarms.push(newAlarm);
        alarmState.isActive = true;

        safeStorageSet({ alarm: alarmState }).catch(console.error);
    });
}

function clearAllAlarms() {
    safeStorageSet({ alarm: DEFAULT_ALARM }).catch(console.error);
}

function deleteAlarm(alarmId) {
    safeStorageGet([STORAGE_KEYS.ALARM], (result) => {
        const alarmState = result.alarm || { ...DEFAULT_ALARM };
        alarmState.alarms = alarmState.alarms.filter(a => a.id !== alarmId);
        alarmState.isActive = alarmState.alarms.length > 0;
        safeStorageSet({ alarm: alarmState }).catch(console.error);
    });
}

function syncAlarmVisuals(state) {
    const statusEl = document.getElementById('alarm-status');
    if (!statusEl) return;

    if (state.isActive && state.alarms.length > 0) {
        statusEl.innerText = `${state.alarms.length} alarm(s) active`;
        statusEl.className = 'alarm-status active';
    } else {
        statusEl.innerText = 'No alarm set';
        statusEl.className = 'alarm-status inactive';
    }
}

function renderAlarmList(state) {
    const listEl = document.getElementById('alarm-list');
    if (!listEl) return;

    listEl.innerHTML = '';

    state.alarms.forEach(alarm => {
        const item = document.createElement('div');
        item.className = 'alarm-item';

        const timeStr = `${alarm.hour.toString().padStart(2, '0')}:${alarm.minute.toString().padStart(2, '0')}`;
        const repeatLabel = alarm.repeat === 'once' ? '' : ` (${alarm.repeat})`;

        item.innerHTML = `
            <span>
                ${timeStr}${repeatLabel}
                <span class="alarm-label">${alarm.active ? 'ON' : 'OFF'}</span>
            </span>
            <button data-id="${alarm.id}" aria-label="Delete alarm">✕</button>
        `;

        listEl.appendChild(item);
    });

    // Add delete listeners
    listEl.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = parseInt(e.target.getAttribute('data-id'));
            deleteAlarm(id);
        });
    });
}

function startAlarmChecker() {
    if (alarmCheckTimer) clearInterval(alarmCheckTimer);

    alarmCheckTimer = setInterval(() => {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday

        safeStorageGet([STORAGE_KEYS.ALARM], (result) => {
            const alarmState = result.alarm || DEFAULT_ALARM;
            const toRemove = [];

            alarmState.alarms.forEach(alarm => {
                if (!alarm.active) return;

                // Check if time matches
                if (alarm.hour !== currentHour || alarm.minute !== currentMinute) return;

                // Prevent multiple triggers within the same minute
                const lastTriggered = alarm.lastTriggered || 0;
                if (Date.now() - lastTriggered < 60000) return;

                let shouldRing = false;

                if (alarm.repeat === 'once') {
                    shouldRing = true;
                } else if (alarm.repeat === 'daily') {
                    shouldRing = true;
                } else if (alarm.repeat === 'weekdays') {
                    // Monday to Friday (1-5)
                    if (currentDay >= 1 && currentDay <= 5) {
                        shouldRing = true;
                    }
                }

                if (shouldRing) {
                    triggerAlarm(alarm);
                    alarm.lastTriggered = Date.now();
                    if (alarm.repeat === 'once') {
                        toRemove.push(alarm.id);
                    }
                }
            });

            if (toRemove.length > 0) {
                alarmState.alarms = alarmState.alarms.filter(a => !toRemove.includes(a.id));
                alarmState.isActive = alarmState.alarms.length > 0;
            }

            safeStorageSet({ alarm: alarmState }).catch(console.error);
        });
    }, 1000);
}
               

function triggerAlarm(alarm) {
    // Play sound
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.frequency.value = 1000;
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        oscillator.start();
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1.0);
        oscillator.stop(audioContext.currentTime + 1.0);
    } catch (e) {}

    // Show notification
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Alarm!", {
            body: `It's ${alarm.hour.toString().padStart(2, '0')}:${alarm.minute.toString().padStart(2, '0')}`,
            icon: "⏰"
        });
    } else if ("Notification" in window && Notification.permission !== "denied") {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                new Notification("Alarm!", {
                    body: `It's ${alarm.hour.toString().padStart(2, '0')}:${alarm.minute.toString().padStart(2, '0')}`,
                    icon: "⏰"
                });
            }
        });
    }

    // Flash the widget
    const widget = document.getElementById('ext-global-watch');
    if (widget) {
        widget.style.boxShadow = '0 0 20px #f1c40f';
        setTimeout(() => {
            widget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.3)';
        }, 2000);
    }
}
    const workInput = document.getElementById('pomo-work-min');
    const breakInput = document.getElementById('pomo-break-min');
    const autoStartInput = document.getElementById('pomo-auto-start');

    if (!workInput || !breakInput || !autoStartInput) return;

    const workMinutes = parseInt(workInput.value) || 25;
    const breakMinutes = parseInt(breakInput.value) || 5;

    safeStorageGet([STORAGE_KEYS.POMODORO], (result) => {
        const state = result.pomodoro || { ...DEFAULT_POMODORO };
        state.workDuration = workMinutes * 60;
        state.breakDuration = breakMinutes * 60;
        state.autoStart = autoStartInput.checked;

        if (!state.isRunning && state.isWorkTime) {
            state.timeLeft = state.workDuration;
            state.totalTime = state.workDuration;
        } else if (!state.isRunning && !state.isWorkTime) {
            state.timeLeft = state.breakDuration;
            state.totalTime = state.breakDuration;
        }

        safeStorageSet({ pomodoro: state }).catch(console.error);
    });
}

function togglePomoSettings() {
    const settingsPanel = document.getElementById('pomo-timer-settings');
    if (settingsPanel) {
        const isHidden = settingsPanel.style.display === 'none' || settingsPanel.style.display === '';
        settingsPanel.style.display = isHidden ? 'block' : 'none';
    }
}

function syncPomodoroVisuals(state) {
    clearInterval(pomodoroTimer);

    if (state.isRunning) {
        startPomodoroCountdown(state);
    } else {
        updatePomodoroDisplay(state);
    }

    const btn = document.getElementById('pomo-start');
    const statusEl = document.getElementById('pomo-status');

    if (btn) {
        btn.innerText = state.isRunning ? 'Pause' : 'Start';
        btn.style.background = state.isRunning ? '#e74c3c' : '#3498db';
    }

    if (statusEl) {
        statusEl.innerText = state.isWorkTime ? `Work time - Cycle ${state.cycleCount + 1}` : 'Break time';
        statusEl.className = 'pomo-status ' + (state.isWorkTime ? 'work' : 'break');
    }
}


function handlePomodoroComplete(state) {
    // Play notification sound if available
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.frequency.value = 800;
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        oscillator.start();
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
        oscillator.stop(audioContext.currentTime + 0.5);
    } catch (e) {
        // Audio not supported, fail silently
    }

    state.isWorkTime = !state.isWorkTime;

    if (state.isWorkTime) {
        state.cycleCount++;
    }

    state.timeLeft = state.isWorkTime ? state.workDuration : state.breakDuration;
    state.totalTime = state.timeLeft;
    state.isRunning = false;

    if (state.autoStart) {
        state.isRunning = true;
    }

    safeStorageSet({ pomodoro: state }).catch(console.error);
    syncPomodoroVisuals(state);
}

function updatePomodoroDisplay(state) {
    const display = document.getElementById('pomo-display');
    if (!display) return;

    const minutes = Math.floor(state.timeLeft / 60);
    const seconds = state.timeLeft % 60;
    display.innerText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function setupDragAndDrop() {
    const mainWidget = document.getElementById('ext-global-watch');
    const watchIcon = document.getElementById('watch-icon');

    if (!mainWidget || !watchIcon) return;

    watchIcon.addEventListener('mousedown', handleMouseDown);
    watchIcon.addEventListener('touchstart', handleTouchStart, { passive: false });
    watchIcon.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const panel = document.getElementById('watch-panel');
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        }
    });

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchend', handleTouchEnd);
    watchIcon.addEventListener('click', handleClick);
}

function handleMouseDown(e) {
    if (e.button !== 0) return;
    startDrag(e.clientX, e.clientY);
    e.preventDefault();
}

function handleTouchStart(e) {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    startDrag(touch.clientX, touch.clientY);
    e.preventDefault();
}

function startDrag(x, y) {
    isDragging = true;
    hasMoved = false;
    startMouseX = x;
    startMouseY = y;

    const mainWidget = document.getElementById('ext-global-watch');
    if (!mainWidget) return;

    const rect = mainWidget.getBoundingClientRect();
    initialWidgetX = rect.left;
    initialWidgetY = rect.top;

    const watchIcon = document.getElementById('watch-icon');
    if (watchIcon) watchIcon.style.cursor = 'grabbing';
}

function handleMouseMove(e) {
    if (!isDragging) return;
    moveDrag(e.clientX, e.clientY);
}

function handleTouchMove(e) {
    if (!isDragging || e.touches.length !== 1) return;
    const touch = e.touches[0];
    moveDrag(touch.clientX, touch.clientY);
    e.preventDefault();
}

function moveDrag(clientX, clientY) {
    const dx = clientX - startMouseX;
    const dy = clientY - startMouseY;

    if (!hasMoved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        hasMoved = true;
    }

    if (hasMoved) {
        const mainWidget = document.getElementById('ext-global-watch');
        if (!mainWidget) return;

        mainWidget.style.right = 'auto';
        mainWidget.style.bottom = 'auto';

        let newX = initialWidgetX + dx;
        let newY = initialWidgetY + dy;

        // Boundary check - keep widget within viewport
        const widgetWidth = mainWidget.offsetWidth;
        const widgetHeight = mainWidget.offsetHeight;
        const maxX = window.innerWidth - widgetWidth;
        const maxY = window.innerHeight - widgetHeight;

        newX = Math.max(0, Math.min(newX, maxX));
        newY = Math.max(0, Math.min(newY, maxY));

        mainWidget.style.left = `${newX}px`;
        mainWidget.style.top = `${newY}px`;
    }
}

function handleMouseUp(e) {
    if (!isDragging) return;
    endDrag();
}

function handleTouchEnd(e) {
    if (!isDragging) return;
    endDrag();
}

function handleClick(e) {
    const panel = document.getElementById('watch-panel');
    if (panel && !hasMoved) {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
    hasMoved = false;
}

function endDrag() {
    isDragging = false;

    const watchIcon = document.getElementById('watch-icon');
    if (watchIcon) watchIcon.style.cursor = 'pointer';

    saveWidgetPosition();
}

function loadWidgetPosition() {
    safeStorageGet([STORAGE_KEYS.WIDGET_POSITION], (result) => {
        const position = result.widgetPosition;
        if (position) {
            const mainWidget = document.getElementById('ext-global-watch');
            if (mainWidget) {
                mainWidget.style.right = 'auto';
                mainWidget.style.bottom = 'auto';
                mainWidget.style.left = `${position.x}px`;
                mainWidget.style.top = `${position.y}px`;
            }
        }
    });
}

function saveWidgetPosition() {
    const mainWidget = document.getElementById('ext-global-watch');
    if (!mainWidget) return;

    const position = {
        x: parseInt(mainWidget.style.left) || 0,
        y: parseInt(mainWidget.style.top) || 0,
        timestamp: Date.now()
    };

    safeStorageSet({ widgetPosition: position }).catch(console.error);
}

function cleanup() {
    clearInterval(localTimer);
    clearInterval(pomodoroTimer);
    clearInterval(alarmCheckTimer);
    localTimer = null;
    pomodoroTimer = null;
    alarmCheckTimer = null;

    // Remove document-level event listeners
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.removeEventListener('touchmove', handleTouchMove);
    document.removeEventListener('touchend', handleTouchEnd);

    if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
    }

    if (widgetInstance && widgetInstance.parentNode) {
        widgetInstance.remove();
    }
    widgetInstance = null;
}

// Initialize
function initialize() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }
}

initialize();
