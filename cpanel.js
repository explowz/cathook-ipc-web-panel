const child_process = require('child_process');
const EventEmitter = require('events');
const extend = require('extend');
const CONSOLE_PATH = '/opt/cathook/ipc/bin/console';

class CathookConsole extends EventEmitter {
    constructor() {
        super();
        const self = this;
        this.init = false;
        this.process = child_process.spawn(CONSOLE_PATH);
        this.process.on('exit', function (code) {
            self.init = false;
            self.emit('exit');
        });
        let buff = '';
        this.process.stdout.on('data', function (data) {
            const z = data.toString();
            for (let i = 0; i < z.length; i++) {
                if (z[i] === '\n') {
                    try {
                        const d = JSON.parse(buff);
                        self.emit('data', d);
                    } catch (e) {
                        console.log('error', e, z, buff);
                        self.emit('data', null);
                    }
                    buff = '';
                } else {
                    buff += z[i];
                }
            }
        });
        this.on('data', function (data) {
            if (!data) return;
            if (data.init) {
                self.init = true;
                self.emit('init');
            }

        });
    }

    command(cmd, data, callback) {
        data = data || {};
        extend(data, {"command": cmd});
        this.process.stdin.write(JSON.stringify(data) + '\n');
        if (callback)
            this.once('data', callback);
    }

    stop() {
        this.command("exit", {});
    }
}

module.exports = CathookConsole;
