const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class Process extends EventEmitter {
    constructor(pid, uid, name) {
        super();
        this.pid = pid;
        this.uid = uid;
        this.name = name;
    }
}

class ProcEvents extends EventEmitter {
    constructor() {
        super();
        this.cache = {};
        this.init = 2;
        this.interval = 0;
        this.setMaxListeners(256);
    }

    start() {
        this.interval = setInterval(this.update.bind(this), 500);
    }

    stop() {
        clearInterval(this.interval);
    }

    storeProcessData(pid) {
        const self = this;
        fs.readFile(`/proc/${pid}/status`, function (err, data) {
            if (err) {
                console.log(err);
                return;
            }
            let name = '';
            let uid = '';
            const lines = data.toString().split('\n');
            lines.forEach(function (line) {
                const match_name = /Name:\t(.+)$/i.exec(line);
                const match_uid = /Uid:\t\d+\t(\d+)/.exec(line);
                if (match_name) name = match_name[1];
                if (match_uid) uid = match_uid[1];
            });
            self.cache[pid] = new Process(pid, uid, name);
            if (!self.init) {
                self.emit('birth', self.cache[pid]);
            }
        });
    }

    checkProcess(pid) {
        const self = this;
        fs.stat(`/proc/${pid}`, function (err, stat) {
            if (err) {
                try {
                    self.emit('death', self.cache[pid]);
                    self.cache[pid].emit('exit');
                    delete self.cache[pid];
                } catch (e) {
                    console.log(e);
                }
            }
        });
    }

    update() {
        const self = this;
        if (this.init) {
            if (!--this.init) {
                self.emit('init');
            }
        }

        // Discard old processes
        for (const key in self.cache) {
            this.checkProcess(key);
        }
        // Check for new processes
        fs.readdir('/proc', function (err, files) {
            if (err) return;
            files.forEach(function (file) {
                const pid = file;
                if (self.cache[pid]) {
                    return;
                }
                if (/^\d+$/.test(file)) {
                    file = path.resolve('/proc', file);
                    fs.stat(file, function (err, stats) {
                        if (err) return;
                        if (stats.isDirectory()) {
                            self.storeProcessData(pid);
                        }
                    });
                }
            });
            self.emit('update');
        });
    }

    find(name, uid) {
        const self = this;
        const result = [];
        for (const key in self.cache) {
            if (self.cache[key].uid === uid && self.cache[key].name === name) {
                result.push(self.cache[key]);
            }
        }
        return result;
    }
}

module.exports = new ProcEvents();
