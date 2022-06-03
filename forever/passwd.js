const fs = require('fs');

class Passwd {
    constructor() {
        this.users = {};
        this.nameMap = {};
    }

    parse(data) {
        this.users = {};
        this.nameMap = {};
        for (const s of data.split('\n')) {
            const m = /(.+):.:(\d+):(\d+):(?:.+?)?:(.+?):/i.exec(s);
            if (!m) continue;
            const user = {
                name: m[1],
                uid: m[2],
                gid: m[3],
                home: m[4]
            };
            this.users[user.uid] = user;
            this.nameMap[user.name] = user.uid;
        }
    }

    read(callback) {
        const self = this;
        fs.readFile('/etc/passwd', function (error, data) {
            if (error) {
                if (callback)
                    callback(error);
                return;
            }
            self.parse(data.toString());
            if (callback)
                callback(null, self);
        });
    }
}

class Groups {
    constructor() {
        this.groups = {};
        this.nameMap = {};
    }

    parse(data) {
        this.groups = {};
        this.nameMap = {};
        for (const s of data.split('\n')) {
            const m = /(.+):.:(\d+):/i.exec(s);
            if (!m) continue;
            const group = {
                name: m[1],
                gid: m[2],
            };
            this.groups[group.gid] = group;
            this.nameMap[group.name] = group.gid;
        }
    }

    read(callback) {
        const self = this;
        fs.readFile('/etc/group', function (error, data) {
            if (error) {
                if (callback)
                    callback(error);
                return;
            }
            self.parse(data.toString());
            if (callback)
                callback(null, self);
        });
    }
}

module.exports = {
    Passwd: Passwd,
    Groups: Groups
};
