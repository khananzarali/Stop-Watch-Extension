// Set up initial storage when extension is installed
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({
        stopwatch: {
            isRunning: false,
            startTime: null,
            elapsedTime: 0
        },
        pomodoro: {
            isRunning: false,
            isWorkTime: true,
            timeLeft: 25 * 60,
            totalTime: 25 * 60,
            workDuration: 25 * 60,
            breakDuration: 5 * 60,
            autoStart: false,
            cycleCount: 0
        },
        alarm: {
            alarms: [],
            isActive: false
        },
        widgetPosition: null
    });
});