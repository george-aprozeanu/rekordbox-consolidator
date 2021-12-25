import fs from "node:fs/promises";
import url from "node:url";
import path from "node:path";
import fg from "fast-glob";
import {unixify} from "fast-glob/out/utils/path";
import {Builder, Parser} from "xml2js";

const libraryXmlFile = process.argv[3];
const outFile = process.argv[4];
const musicLocation = process.argv.slice(5);

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

function rootname(filename: string) {
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
    return rootname(filename);
}


async function readLibrary(libraryXmlFile: string, sources: Map<string, string>) {
    const parser = new Parser();
    const library = await parser.parseStringPromise(await fs.readFile(libraryXmlFile));
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
    return new Builder().buildObject(library);
}

async function getSources(musicLocation: string[]) {
    const sources = await fg(musicLocation.map(dir => unixify(path.join(dir, '**'))));
    return new Map(sources.map(source => [rootname(source), source]));
}

(async function main() {
    const sources = await getSources(musicLocation);
    const output = await readLibrary(libraryXmlFile, sources);
    await fs.writeFile(outFile, output);
})().catch(console.error);
