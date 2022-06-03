const EventEmitter = require('events');
const child_process = require('child_process');

const timestamp = require('time-stamp');
const fs = require('fs');
const procfs = require('procfs-stats');
const path = require("path");
const {Tail} = require("tail");

const accounts = require('./acc.js');

const LAUNCH_OPTIONS_STEAM = 'firejail --dns=1.1.1.1 %NETWORK% --noprofile --private="%HOME%" --name=%JAILNAME% --env=PULSE_SERVER="unix:/tmp/pulse.sock" --env=DISPLAY=%DISPLAY% --env=LD_PRELOAD=%LD_PRELOAD% %STEAM% -silent -login %LOGIN% %PASSWORD% -nominidumps -nobreakpad -no-browser -nofriendsui'
const LAUNCH_OPTIONS_STEAM_RESET = 'firejail --net=none --noprofile --private="%HOME%" %STEAM% --reset'
const LAUNCH_OPTIONS_GAME = 'firejail --join=%JAILNAME% bash -c \'cd ~/$GAMEPATH && %REPLACE_RUNTIME% LD_PRELOAD=%LD_PRELOAD% DISPLAY=%DISPLAY% PULSE_SERVER="unix:/tmp/pulse.sock" ./hl2_linux -game tf -silent -sw -small -w 640 -h 200 -novid -nojoy -noshaderapi -nomouse -nomessagebox -nominidumps -nohltv -nobreakpad -particles 512 -snoforceformat -softparticlesdefaultoff -threads 1\''
const LAUNCH_OPTIONS_GAME_NATIVE = LAUNCH_OPTIONS_GAME.replace("%REPLACE_RUNTIME%", 'LD_LIBRARY_PATH="$LD_LIBRARY_PATH:./bin"');
const LAUNCH_OPTIONS_GAME_RUNTIME = LAUNCH_OPTIONS_GAME.replace("%REPLACE_RUNTIME%", 'LD_LIBRARY_PATH="$(~/"%STEAM_RUNTIME%" printenv LD_LIBRARY_PATH):./bin"');

const TIMEOUT_START_GAME = 10000;
const TIMEOUT_IPC_STATE = 70000;
const TIMEOUT_STEAM_RUNNING = 70000;
const MAX_CONCURRENT_BOTS = 3;
const DELAY_START_TIME = 1000;

const STATE = {
    INITIALIZING: 0,
    INITIALIZED: 1,
    STARTING: 3,
    WAITING: 4,
    RUNNING: 5,
    RESTARTING: 6,
    STOPPING: 7,
    NO_ACCOUNT: 8
}

function makeid(length) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

function clearSourceLockFiles() {
    const files = fs.readdirSync('/tmp/');
    files.forEach((str, index, arr) => {
        if (str.startsWith("source_engine") && str.endsWith(".lock"))
            fs.unlink(`/tmp/${str}`, (err) => {
                if (err)
                    console.log("[ERROR] Failed to delete a source engine lock!");
            });
    });
}

if (!process.env.SUDO_USER) {
    process.exit(1);
}

const USER = {
    name: process.env.SUDO_USER,
    uid: Number.parseInt(child_process.execSync("id -u " + process.env.SUDO_USER).toString().trim()),
    home: child_process.execSync(`printf ~${process.env.SUDO_USER}`).toString(),
    interface: child_process.execSync("route -n | grep '^0\.0\.0\.0' | grep -o '[^ ]*$' | head -n 1").toString().trim(),
    SUPPORTS_FJ_NET: true
};
try {
    child_process.execSync(`firejail --quiet --noprofile --net=${USER.interface} bash -c "ping -q -c 1 -W 1 1.1.1.1 >/dev/null && echo ok"`)
} catch (error) {
    USER.SUPPORTS_FJ_NET = false;
}


class Bot extends EventEmitter {
    constructor(botid) {
        super();
        const self = this;
        this.state = STATE.INITIALIZING;

        this.name = "b" + botid;
        this.botid = botid;
        this.home = path.join(__dirname, "..", "..", "user_instances", this.name)

        if (!USER.SUPPORTS_FJ_NET)
            child_process.execSync("./network/route " + this.botid)

        this.stopped = false;
        this.account = null;
        this.restarts = 0;

        this.procFirejailSteam = null;
        this.procFirejailGame = null;

        // Start timestamp
        this.startTime = null;

        this.ipcState = null;
        this.ipcLastHeartbeat = 0;
        this.ipcID = -1;

        this.gameStarted = 0;

        this.logSteam = null;
        this.logGame = null;

        this.nativeSteam = fs.existsSync("/usr/bin/steam-native");

        this.spawnOptions = {
            shell: 'bash',
            uid: USER.uid,
            env: {
                PATH: process.env.PATH,
                HOME: USER.home
            }
        }

        this.on('ipc-data', function (obj) {
            if (self.state !== STATE.RUNNING && self.state !== STATE.WAITING)
                return;
            const id = obj.id;
            const data = obj.data;
            if (data.heatbeat === self.ipcLastHeartbeat)
                return;
            self.ipcLastHeartbeat = data.heartbeat;

            self.ipcID = id;
            self.ipcState = data;
        });

        this.state = STATE.INITIALIZED;

        this.shouldRun = false;
        this.shouldRestart = false;
        this.isSteamWorking = false;
        this.time_steamWorking = 0;
        this.time_gameCheck = 0;
        this.time_ipcState = 0;
        this.shouldResetSteam = false;
    }

    // debug?
    log(message) {
        console.log(`[${timestamp('HH:mm:ss')}][${this.name}][${this.state}] ${message}`);
    }

    shouldSetupSteamapps() {
        try {
            return fs.existsSync(this.steamApps) && !fs.lstatSync(this.steamApps).isSymbolicLink();
        } catch (error) {
            return false;
        }
    }

    setupSteamapps() {
        // I'm scared of doing recursive deletes in nodejs
        fs.renameSync(this.steamApps, path.resolve(this.steamApps, '..', 'steamapps_old'));
        fs.symlinkSync("/opt/steamapps/", this.steamApps);
        return true;
    }

    spawnSteam() {
        const self = this;
        if (self.procFirejailSteam) {
            return;
        }

        if (!fs.existsSync(self.home)) {
            fs.mkdirSync(self.home);
            fs.chownSync(self.home, USER.uid, USER.uid);
        }

        const steambin = this.nativeSteam ? "steam-native" : "steam";

        self.procFirejailSteam = child_process.spawn(([this.shouldResetSteam, this.shouldResetSteam = 0][0] ? LAUNCH_OPTIONS_STEAM_RESET : LAUNCH_OPTIONS_STEAM)
                .replace("%LOGIN%", self.account.login)
                .replace("%PASSWORD%", self.account.password)
                .replace("%JAILNAME%", self.name)
                .replace("%LD_PRELOAD%", `"${process.env.STEAM_LD_PRELOAD}"`)
                .replace("%DISPLAY%", process.env.DISPLAY)
                .replace("%NETWORK%", USER.SUPPORTS_FJ_NET ? `--net=${USER.interface}` : `--netns=catbotns${this.botid}`)
                .replace("%HOME%", self.home)
                .replace("%STEAM%", steambin),
            self.spawnOptions);
        self.logSteam = fs.createWriteStream('./network/wpanel-logs/' + self.name + '.steam.log');
        self.logSteam.on('error', (err) => {
            self.log(`error on logSteam pipe: ${err}`)
        });
        self.procFirejailSteam.stdout.pipe(self.logSteam);

        let tail_steam_err_logs = [];
        const steam_path = path.join(this.home, ".steam/steam");

        function processErrorLogs(text) {
            if (text.includes("System startup time:")) {

                const steam_apps = path.join(steam_path, "steamapps");
                self.steamPath = path.resolve(this.home, path.relative(USER.home, fs.realpathSync(steam_path)));
                self.steamApps = path.resolve(this.home, path.relative(USER.home, fs.realpathSync(steam_apps)));
                self.tf2Path = path.join(this.steamApps, "common/Team Fortress 2");

                self.isSteamWorking = true;
                if (self.shouldSetupSteamapps()) {
                    self.setupSteamapps();
                }

                for (let i = 0; i < tail_steam_err_logs.length; i++) {
                    if (tail_steam_err_logs[i]) {
                        tail_steam_err_logs[i].unwatch();
                    }
                }
                tail_steam_err_logs = [];
            }
            if (RegExp("Failed to load .*\.so: cannot open shared object file: .*").test(text)) {
                this.shouldRestart = true;
                this.shouldResetSteam = true;
            }
        }

        function registerDebianListener() {
            try {
                tail_steam_err_logs.push(new Tail(path.join(this.home, ".steam/debian-installation/error.log")));
                tail_steam_err_logs[tail_steam_err_logs.length - 1].on('line', (data) => {
                    processErrorLogs.bind(this)(data);
                })
            } catch (error) {
                self.log("No debian-installation/error.log file found.");
                tail_steam_err_logs.pop();
            }
        }

        const isDebian = !fs.existsSync("/usr/bin/steam") && fs.existsSync("/usr/games/steam");
        self.procFirejailSteam.stderr.on("data", (data) => {
            const text = data.toString();
            processErrorLogs.bind(this)(text);
        });

        self.procFirejailSteam.stdout.on("data", (data) => {
            const text = data.toString();
            // Extend time if we are downloading updates.
            if (text.includes(" Downloading update (")) {
                self.time_steamWorking = Date.now() + TIMEOUT_STEAM_RUNNING;
            }
            if (text.includes("Error: You are missing the following 32-bit libraries, and Steam may not run:")
                || text.includes("Error: Couldn't set up the Steam Runtime. Are you running low on disk space?")) {
                this.shouldRestart = true;
                this.shouldResetSteam = true;
            }
            if (isDebian && text.includes("Running Steam on"))
                registerDebianListener.bind(this)();
        });
        self.procFirejailSteam.stderr.pipe(self.logSteam);
        self.procFirejailSteam.on('exit', self.handleSteamExit.bind(self));
        if (tail_steam_err_logs.length)
            self.procFirejailSteam.on('exit', () => {
                for (let i = 0; i < tail_steam_err_logs.length; i++) {
                    if (tail_steam_err_logs[i]) {
                        tail_steam_err_logs[i].unwatch();
                        tail_steam_err_logs[i] = null;
                    }
                }
                tail_steam_err_logs = [];
            });
        self.log(`Launched ${steambin} (${self.procFirejailSteam.pid})`);
        self.emit('start-steam', self.procFirejailSteam.pid);
    }

    spawnGame() {
        const self = this;
        this.restarts++;

        const filename = `/tmp/.gl${makeid(6)}`;
        fs.copyFileSync("/opt/cathook/bin/libcathook-textmode.so", filename);

        clearSourceLockFiles();

        self.procFirejailGame = child_process.spawn((this.nativeSteam ? LAUNCH_OPTIONS_GAME_NATIVE : LAUNCH_OPTIONS_GAME_RUNTIME).replace("$GAMEPATH", path.relative(self.home, self.tf2Path).replace(/(\s+)/g, '\\$1'))
                .replace("%JAILNAME%", self.name)
                .replace("%LD_PRELOAD%", `"${filename}:${process.env.STEAM_LD_PRELOAD}"`)
                .replace("%DISPLAY%", process.env.DISPLAY)
                .replace("%STEAM_RUNTIME%", path.relative(self.home, path.join(self.steamPath, "/ubuntu12_32/steam-runtime/run.sh"))),
            [], self.spawnOptions);
        self.logGame = fs.createWriteStream('./network/wpanel-logs/' + self.name + '.game.log');
        self.logGame.on('error', (err) => {
            self.log(`error on logGame pipe: ${err}`)
        });
        self.procFirejailGame.stdout.pipe(self.logGame);
        self.procFirejailGame.stderr.pipe(self.logGame);
        self.procFirejailGame.on('exit', self.handleGameExit.bind(self));

        setTimeout(function () {
            fs.unlinkSync(filename);
        }, TIMEOUT_START_GAME);
    }

    handleSteamExit(code, signal) {
        this.log(`Steam (${this.procFirejailSteam.pid}) exited with code ${code}, signal ${signal}`);
        this.emit('exit-steam');

        this.isSteamWorking = false;

        delete this.procFirejailSteam;
    }

    handleGameExit(code, signal) {
        this.log(`Game (${this.procFirejailGame.pid}) exited with code ${code}, signal ${signal}`);
        this.ipcState = null;
        delete this.procFirejailGame;
    }

    reset() {
        this.procFirejailSteam = null;
        this.procFirejailSteam = null;
        this.isSteamWorking = false;
        this.time_steamWorking = 0;
        this.time_gameCheck = 0;
        this.time_ipcState = 0;
        this.shouldRestart = false;
        this.ipcState = null;
    }

    killSteam() {
        this.log('Killing steam');
        if (this.procFirejailSteam)
            this.procFirejailSteam.kill("SIGINT");
    }

    killGame() {
        this.log('Killing game');
        if (this.procFirejailGame)
            this.procFirejailGame.kill("SIGINT");
    }

    gameCheck() {
        try {
            const gamepid = Number.parseInt(child_process.execSync(`pgrep -P ${this.procFirejailGame.pid}`).toString().trim());

            const self = this;
            procfs(gamepid).stat(function (err, ret) {
                if (err) {
                    self.log("Error while getting stat.");
                } else {
                    self.startTime = ret.starttime;
                }
            })

            this.log(`Found game (${gamepid})`);
            this.emit('start-game', this.procFirejailGame.pid);
            clearSourceLockFiles();
        } catch (error) {
            this.log('[ERROR] Could not find running game!');
            return false;
        }
        return true;
    }

    update() {
        const time = Date.now();
        if (this.shouldRun && !this.shouldRestart) {
            if (this.procFirejailSteam) {
                if (!this.isSteamWorking) {
                    if (this.time_steamWorking && time > this.time_steamWorking) {
                        this.shouldRestart = true;
                        this.time_steamWorking = 0;
                    }

                } else {
                    if (!this.procFirejailGame) {
                        this.spawnGame();
                        this.state = STATE.WAITING;
                        this.time_gameCheck = time + TIMEOUT_START_GAME;
                    } else {
                        if (this.time_gameCheck) {
                            if (time > this.time_gameCheck) {
                                if (!this.gameCheck()) {
                                    this.shouldRestart = true;
                                    this.time_gameCheck = Number.MAX_SAFE_INTEGER;
                                } else {
                                    this.time_gameCheck = 0;
                                    this.time_ipcState = time + TIMEOUT_IPC_STATE;
                                }
                            }
                        } else {
                            if (this.ipcState) {
                                this.time_ipcState = 0;
                                this.state = STATE.RUNNING;
                                this.gameStarted = time;
                            } else if (this.time_ipcState && time > this.time_ipcState) {
                                this.killGame();
                                this.time_ipcState = 0;
                            }

                        }

                    }
                }
            } else {
                if (this.procFirejailGame) {
                    this.killGame();
                } else {
                    if (!this.account) {
                        this.state = STATE.NO_ACCOUNT;
                        this.log('Preparing to restart with new account...');
                        this.account = accounts.get(this.botid);
                    }
                    if (this.account && module.exports.currentlyStartingGames < MAX_CONCURRENT_BOTS && module.exports.lastStartTime + DELAY_START_TIME < time) {
                        module.exports.lastStartTime = time;
                        module.exports.currentlyStartingGames++;
                        this.state = STATE.STARTING;
                        this.reset();
                        this.spawnSteam();
                        this.time_steamWorking = time + TIMEOUT_STEAM_RUNNING;
                    }
                }
            }
        } else {
            if (this.procFirejailGame) {
                this.killGame();
            }
            if (this.procFirejailSteam) {
                this.killSteam();
            }
            this.state = STATE.STOPPING;
            if (!this.procFirejailSteam && !this.procFirejailGame) {
                this.state = this.shouldRestart ? STATE.RESTARTING : STATE.INITIALIZED;
                this.shouldRestart = false;
            }
            if (this.account)
                this.account = null;
        }
    }

    restart() {
        if (this.shouldRun)
            this.shouldRestart = true;
        else
            this.shouldRun = true;
    }

    stop() {
        this.shouldRun = false;
    }

    full_stop() {
        this.stop();

        if (!USER.SUPPORTS_FJ_NET && fs.existsSync(`/var/run/netns/catbotns${this.botid}`))
            child_process.execSync(`./network/delete ${this.botid}`)
        return !(this.procFirejailGame || this.procFirejailSteam)
    }
}

module.exports.bot = Bot;
module.exports.currentlyStartingGames = 0;
module.exports.lastStartTime = 0;
module.exports.states = STATE;
