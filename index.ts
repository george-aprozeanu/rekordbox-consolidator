import fs from "node:fs/promises";
import url from "node:url";
import path from "node:path";
import fg from "fast-glob";
import {unixify} from "fast-glob/out/utils/path";
import {Builder, Parser} from "xml2js";

const configFile = process.argv[3];

interface Track {
    '$': {
        Location: string
        TrackID: string
        Rating: string
    }
}

function trackOrder(a: Track, b: Track) {
    return b['$'].Rating.localeCompare(a['$'].Rating);
}

function rootName(filename: string) {
    const namePattern = /(.*)-\d/g;
    const ext = path.extname(filename);
    const basename = path.basename(filename, ext);
    const match = namePattern.exec(basename);
    if (match !== null) {
        return `${match[1]}${ext}`;
    } else {
        return `${basename}${ext}`;
    }
}

function trackBasename(track: Track) {
    const filename = new url.URL(track['$'].Location).pathname;
    return rootName(filename);
}


async function readLibrary(library: any, sources: Map<string, string>) {
    const Parent = library['DJ_PLAYLISTS']['COLLECTION'][0];
    const trackNames = new Map<string, any>();
    for (const track of Parent.TRACK) {
        const basename = trackBasename(track);
        if (!trackNames.has(basename)) {
            trackNames.set(basename, []);
        }
        trackNames.get(basename).push(track);
    }
    const duplicates = new Map<string, string>();
    for (const tracks of trackNames.values()) {
        if (tracks.length > 1) {
            tracks.sort(trackOrder);
        }
        const remainingTrackId = tracks[0]['$'].TrackID;
        tracks.slice(1).forEach((track: Track) => {
            duplicates.set(track['$'].TrackID, remainingTrackId);
        })
    }
    Parent.TRACK = Parent.TRACK.filter((track: Track) => {
        return sources.has(trackBasename(track)) && !duplicates.has(track['$'].TrackID)
    })
    Parent.TRACK.forEach((track: Track) => {
        const basename = path.basename(new url.URL(track['$'].Location).pathname);
        track['$'].Location = `file://localhost/${sources.get(basename)!}`;
    })
    return library;
}

async function getSources(musicLocation: string[]) {
    const sources = await fg(musicLocation.map(dir => unixify(path.join(dir, '**'))));
    return new Map(sources.map(source => [rootName(source), source]));
}

(async function main() {
    const {input, output, musicDirs} = JSON.parse(await fs.readFile(configFile, "utf-8"));
    const sources = await getSources(musicDirs);
    let library = await new Parser().parseStringPromise(await fs.readFile(input));
    library = await readLibrary(library, sources);
    await fs.writeFile(output, new Builder().buildObject(library));
})().catch(console.error);
