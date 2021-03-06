const axios = require('axios');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone'); // dependent on utc plugin
const duration = require('dayjs/plugin/duration');
const customParseFormat = require('dayjs/plugin/customParseFormat')
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(duration);
dayjs.extend(customParseFormat);
const util = require('util');
const namecase = require('namecase');
const ical = require('node-ical');
const cheerio = require('cheerio');
const { google } = require('googleapis');
const crypto = require('crypto');

const conf = require('../config');
const { venues } = require('../venues');
const db = require('../db');

const twoweeks = dayjs.duration(2, 'w').asMilliseconds();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function str_escape(string_to_escape) {
  const reg1 = /'/g
  const reg2 = /;/g
  let escaped_string = string_to_escape.replace(reg1, "\\'");
  escaped_string = escaped_string.replace(reg2, "\\;");
  return escaped_string;
}

async function dblookup_artist(namestring, dbpool) {
  const escaped_string = str_escape(namestring);
  const querystring = "SELECT actor_Name, actor_ID FROM actor WHERE actor_Name LIKE '%" + escaped_string + "%'";
  try {
    const rows = await db.query(dbpool, querystring);
    if (typeof rows !== 'undefined') {
      return rows;
    } else {
      const nullarr = [];
      return nullarr;
    }
  } catch (error) {
    console.error(error);
  }
}

async function dblookup_shows(dbpool, retype) {
  const returnobj = {};
  const returnarr = [];
  const rightnow = dayjs().tz("America/New_York").unix() - 86400;
  const querystring = `SELECT activity_ID, activity_API, activity_API_ID, activity_StartDate, activity_Time, activity_EndDate, activity_Blurb, activity_VenueID, venue_ID, venue_Name FROM activity, venue WHERE activity_VenueID=venue_ID AND UNIX_TIMESTAMP(activity_EndDate) >= ${rightnow} ORDER BY activity_StartDate`;
  try {
    const rows = await db.query(dbpool, querystring);
    if (typeof rows !== 'undefined') {
      for (let row of rows) {
        const idx = row.activity_API_ID;
        const querystring2 = `SELECT * from (actor,actlink) where actor_ID=actlink_ActorID AND actlink_ActivityID=${row.activity_ID} order by actlink_ID`;
        const actors = await db.query(dbpool, querystring2);
        if (typeof actors !== 'undefined') {
          row.actors = actors;
        }
        if (retype === 'object') {
          returnobj[idx] = row;
        } else {
          returnarr.push(row);
        }
      }
      if (retype === 'object') {
        return returnobj;
      } else {
        return returnarr;
      }
    } else {
      const nullarr = [];
      return nullarr;
    }
  } catch (error) {
    console.error(error);
  }
}

async function dbinsert(insertObj) {
  const dbpool = await db.getPool();
  const vals = [];
  let cols = '(';
  let placeholders = '(';
  for (column in insertObj.fields) {
    cols += column + ", ";
    placeholders += "?, ";
    vals.push(insertObj.fields[column]);
  }
  const reg = /\, $/;
  cols = cols.replace(reg, ')');
  placeholders = placeholders.replace(reg, ')');
  const statement = `INSERT into ${insertObj.table} ${cols} VALUES ${placeholders}`;
  try {
    const result = await dbpool.execute(statement, vals);
    return result;
  } catch (error) {
    console.error(error);
  }
}

function find_URLs(testchunk) {
  const urlsarray = [];
  if(typeof testchunk !== 'undefined' && testchunk !== '') {
    const urlregex = /(?<grp1>(?<grp2>(?<grp3>[A-Za-z]{3,9}:(?:\/\/)?)(?:[\-;:&=\+\$,\w]+@)?[A-Za-z0-9\.\-]+|(?:www\.|[\-;:&=\+\$,\w]+@)[A-Za-z0-9\.\-]+)(?<grp7>(?:\/[\+~%\/\.\w\-_]*)?\??(?:[\-\+=&;%@\.\w_]*)#?(?:[\.\!\/\\\w]*))?)/gi;
    const httpregex = /^http[s]*:\/\//;
    const matches = testchunk.matchAll(urlregex);
    for (const match of matches) {
      const testurl = match.groups.grp2.replace(httpregex,'');
      const hostarray = [
        'open.spotify.com',
        'www.facebook.com',
        'www.instagram.com',
        'www.youtube.com',
        'catscradle.com',
        'facebook.com',
        'instagram.com',
        'soundcloud.com',
        'spotify.com',
        'youtube.com',
        'apple.com',
      ];
      if(!hostarray.includes(testurl.toLowerCase())) {
        urlsarray.push(match.groups.grp1);
      }
    }
  }
  return urlsarray;
}

async function to_titlecase(candidate) {
  if (namecase.checkName(candidate)) {
    return namecase(candidate);
  } else {
    return candidate;
  }
}

async function artist_lookup(artists, dbpool) {
  const returnarr = [];
  for (artist of artists) {
    let blurb_snippet = '';
    const reg1 = /an evening with/ig;
    const reg2 = / \([^\(]*\)/gi;
    const reg3 = /(vinyl)* album release (party|show)*/i;
    const reg4 = / and /ig;
    const reg5 = / & /ig;
    const reg6 = /\//ig;
    const reg7 = / with /ig;
    const reg8 = /\W$/;
    const reg9 = /^(?<article>A |An |The )/i;
    const reg10 = /and friends/gi;
    const reg11 = /special guest(s)*/gi;
    const reg12 = /\s{1}[b-zB-z]{1}\s{1}/g;
    const reg13 = /featuring/gi;
    const reg14 = /:/g;
    const reg15 = / more(\W)?$/i;
    const reg16 = /(?<blurb>in the record shop)/i;
    const reg17 = / \+ /gi;
    const reg18 = / - /gi;
    const reg20 = / ??? /gi; // yes this is a different dash
    const reg19 = /\&amp;/gi;
    let name1 = artist.name.replace(reg1,'');
    const found = name1.match(reg16);
    if (found !== null) {
      blurb_snippet = found.groups.blurb;
      name1 = name1.replace(reg16, '');
    }
    name1 = name1.replace(reg10,' ');
    name1 = name1.replace(reg19, '&');
    name1 = name1.replace(reg12, ', ');
    name1 = name1.replace(reg13, ', ');
    name1 = name1.replace(reg15, '');
    name1 = name1.replace(reg9,'');
    name1 = name1.replace(reg3,' ');
    name1 = name1.replace(reg2,'');
    name1 = name1.replace(reg4,', ');
    name1 = name1.replace(' w/', ', ');
    name1 = name1.replace(reg7, ', ');
    name1 = name1.replace(reg11,'');
    name1 = name1.replace(reg5, ', ');
    name1 = name1.replace(reg17, ', ');
    name1 = name1.replace(reg18, ', ');
    name1 = name1.replace(reg20, ', ');
    name1 = name1.replace(reg6, ', ');
    name1 = name1.replace(reg8,'');
    name1 = name1.replace(reg14,', ');
    const parts = name1.split(',');
    for (const part of parts) {
      let candidate = part.trim();
      candidate = candidate.replace(reg9, '');
      const falses = [];
      const trues = [];
      candidate = await to_titlecase(candidate);
      if (candidate.length > 2 && candidate !== 'And') {
        const dbartist = await dblookup_artist(candidate, dbpool);
        if (typeof dbartist === 'undefined' || dbartist.length === 0) {
          const candobj = {
            'origname': candidate,
            'dbname': '',
            'id': '',
            'best': false,
            'blurb_snippet': blurb_snippet,
            'url': artist.url,
          };
          falses.push(candobj);
        } else if (dbartist.length >= 1) {
          for (artobj of dbartist) {
            const articlereg = / \[(The|A|An)\]$/;
            const compname = artobj.actor_Name.replace(articlereg,'');
            if (compname.toLowerCase() === candidate.toLowerCase()) {
              const candobj = {
                'origname': candidate,
                'dbname': artobj.actor_Name,
                'id': artobj.actor_ID,
                'best': true,
                'blurb_snippet': blurb_snippet,
                'url': artist.url,
              };
              trues.push(candobj);
            } else {
              const candobj = {
                'origname': candidate,
                'dbname': artobj.actor_Name,
                'id': artobj.actor_ID,
                'best': false,
                'blurb_snippet': blurb_snippet,
                'url': artist.url,
              };
              falses.push(candobj);
            }
          }
        }
      } else if (candidate.length > 0){
        const candobj = {
          'origname': candidate,
          'dbname': '',
          'id': '',
          'best': false,
          'blurb_snippet': blurb_snippet,
          'url': artist.url,
        };
        falses.push(candobj);
      }
      if (trues.length > 0) {
        for (const tru of trues) {
          returnarr.push(tru);
        }
      } else {
        for (const fals of falses) {
          returnarr.push(fals);
        }
      }
    }
  }
  return returnarr;
}


async function etix(venueID, timeWindow, dbpool) {
  const etix_url = "https://api.etix.com/v1/public/activities?venueIds="+venueID;
  const config = {
    headers: {apiKey: conf.etix_api_key},
  };
  try {
    const response = await axios.get(etix_url, config);
    const returnarr = [];
    for (const activity of response.data.venues[0].activities) {
      const startTime = dayjs(activity.startTime);
      if (typeof activity.status !== 'undefined' && activity.status !== "notOnSale" && activity.activityType === "performance" && startTime.isBefore(dayjs().add(timeWindow, 'ms'))) {
        const startDate = startTime.tz("America/New_York").format('YYYY-MM-DD');
        const activityTime = startTime.tz("America/New_York").format('HH:mm:ss');
        const timestamp = startTime.tz( "America/New_York").set('h',12).set('m',0).set('s',0).set('ms',0);
        const rawArtists = [];
        const urls = find_URLs(activity.description);
        const eventObj = {
          "activity_Timestamp": timestamp.unix(),
          "activity_startDate": startDate,
          "activity_Time": activityTime,
          "activity_endDate": startDate,
          "activity_timeObj": startTime,
          "activity_API": "etix",
          "activity_API_ID": activity.id,
          "orig_artists": [],
          "artists": [],
          "urls": urls,
          "activity_Blurb": '',
        }
        if (typeof activity.performers[0] !== 'undefined') {
          for (const performer of activity.performers) {
            const artist = {
              "name": performer.name,
              "url": performer.linkURL,
            }
            eventObj.orig_artists.push(artist);
            rawArtists.push(artist);
          }
        }
        const artist = {
          "name": activity.name,
          "url": "",
        }
        eventObj.orig_artists.push(artist);
        rawArtists.push(artist);
        const cookedArtists = await artist_lookup(rawArtists, dbpool);
        for (const artiste of cookedArtists) {
          eventObj.artists.push(artiste);
          if (typeof artiste.blurb_snippet !== 'undefined') {
            eventObj.activity_Blurb = artiste.blurb_snippet;
          }
        }
        returnarr.push(eventObj);
      }
    }
    return returnarr;
  } catch (error) {
    console.error(error);
  }
}

async function eventbrite(venueID, timeWindow, dbpool) {
  const ebrite_url_prefix = "https://www.eventbriteapi.com/v3/venues/";
  const ebrite_url_suffix = "/events/?status=live";
  const ebrite_url = ebrite_url_prefix + venueID + ebrite_url_suffix;
  const config = {
    headers: { Authorization: "Bearer "+conf.eventbrite_api_key },
  };
  try {
    const response = await axios.get(ebrite_url, config);
    const returnarr = [];
    for (const activity of response.data.events) {
      const startTime = dayjs(activity.start.utc);
      if(typeof activity.status !== 'undefined' && activity.status === 'live' && startTime.isBefore(dayjs().add(timeWindow, 'ms'))) {
        const timestamp = startTime.set('h',12).set('m',0).set('s',0).set('ms',0);
        const startDate = startTime.tz("America/New_York").format('YYYY-MM-DD');
        const activityTime = startTime.tz("America/New_York").format('HH:mm:ss');
        const rawArtist = {
            "name": activity.name.text,
            "url": "",
          };
        const rawArtists = [];
        const urls = find_URLs(activity.description.text);
        const eventObj = {
          "activity_API": "eventbrite",
          "activity_API_ID": activity.id,
          "activity_Timestamp": timestamp.unix(),
          "activity_startDate": startDate,
          "activity_Time": activityTime,
          "activity_endDate": startDate,
          "activity_timeObj": startTime,
          "orig_artists": [],
          "artists": [],
          "urls": urls,
          "activity_Blurb": '',
        };
        eventObj.orig_artists.push(rawArtist);
        rawArtists.push(rawArtist);
        const cookedArtists = await artist_lookup(rawArtists, dbpool);
        for (const artiste of cookedArtists) {
          eventObj.artists.push(artiste);
          if (typeof artiste.blurb_snippet !== 'undefined') {
            eventObj.activity_Blurb = artiste.blurb_snippet;
          }
        }
        returnarr.push(eventObj);
      }
    }
    return returnarr;
  } catch (error) {
    console.error(error);
  }
}

async function ticketmaster(venueID, timeWindow, dbpool) {
  const endDate = dayjs().add(timeWindow, 'ms').format('YYYY-MM-DDTHH:mm:ss[Z]');
  const ticketmaster_url_prefix = "http://app.ticketmaster.com/discovery/v2/events.json?apikey="+conf.ticketmaster_api_key+"&venueId=";
  const ticketmaster_url_suffix = "&size=40&sort=date,asc&endDateTime=" + endDate;
  const ticketmaster_url = ticketmaster_url_prefix + venueID + ticketmaster_url_suffix;
  try {
    const response = await axios.get(ticketmaster_url);
    await sleep(800);
    const returnarr = [];
    if (typeof response.data._embedded !== 'undefined') {
      for (const activity of response.data._embedded.events) {
        if (typeof activity.dates.status.code !== 'undefined' && activity.dates.status.code !== 'cancelled' && typeof activity.classifications !== 'undefined' && activity.classifications[0].segment.name === 'Music') {
          const rawArtist = {
            "name": activity.name,
            "url": "",
            };
          const rawArtists = [];
          const urls = find_URLs(activity.info);
          const startTime = dayjs(activity.dates.start.dateTime);
          const startDate = startTime.tz("America/New_York").format('YYYY-MM-DD');
          const activityTime = startTime.tz("America/New_York").format('HH:mm:ss');
          const timestamp = startTime.set('h',12).set('m',0).set('s',0).set('ms',0);
          const eventObj = {
            "activity_startDate": startDate,
            "activity_Time": activityTime,
            "activity_endDate": startDate,
            "activity_Timestamp": timestamp.unix(),
            "activity_timeObj": startTime,
            "activity_API": "ticketmaster",
            "activity_API_ID": activity.id,
            "artists": [],
            "orig_artists": [],
            "urls": urls,
            "activity_Blurb": '',
          }
          if (typeof activity._embedded.attractions !== 'undefined' && typeof activity._embedded.attractions[0] !== 'undefined') {
            for (const performer of activity._embedded.attractions) {
              const artist = {
                "name": performer.name,
              }
              if (typeof performer.externalLinks !== 'undefined' && typeof performer.externalLinks.homepage !== 'undefined') {
                artist.url = performer.externalLinks.homepage[0].url;
              }
              eventObj.orig_artists.push(artist);
              rawArtists.push(artist);
            }
          }
          rawArtists.push(rawArtist);
          eventObj.orig_artists.push(rawArtist);
          const cookedArtists = await artist_lookup(rawArtists, dbpool);
          for (const artiste of cookedArtists) {
            eventObj.artists.push(artiste);
            if (typeof artiste.blurb_snippet !== 'undefined') {
              eventObj.activity_Blurb = artiste.blurb_snippet;
            }
          }
          returnarr.push(eventObj);
        }
      }
    }
    return returnarr;
  } catch (error) {
    console.error(error);
  }
}

async function ical_events(baseURL, timeWindow, dbpool) {
  const returnarr = [];
  try {
    const venueURL = baseURL + '?ical=1&tribe_display=list';
    const webEvents = await ical.async.fromURL(venueURL);
    for (const idx in webEvents) {
      const startTime = dayjs(webEvents[idx].start);
      if (webEvents[idx].type === 'VEVENT' && startTime.isAfter(dayjs()) && startTime.isBefore(dayjs().add(timeWindow, 'ms'))) {
        //  && webEvents[idx].categories[0] === 'Show' -- not universal, sigh
        if (typeof webEvents[idx].categories !== 'undefined' && webEvents[idx].categories[0] !== 'undefined' && webEvents[idx].categories[0] !== 'Show') {
          continue;
        }
        const rawArtist = {
          "name": webEvents[idx].summary,
          "url": "",
          };
        const rawArtists = [];
        const urls = find_URLs(webEvents[idx].description);
        const startDate = startTime.tz("America/New_York").format('YYYY-MM-DD');
        const activityTime = startTime.tz("America/New_York").format('HH:mm:ss');
        const timestamp = startTime.set('h',12).set('m',0).set('s',0).set('ms',0);
        const eventObj = {
          "activity_startDate": startDate,
          "activity_Time": activityTime,
          "activity_endDate": startDate,
          "activity_Timestamp": timestamp.unix(),
          "activity_timeObj": startTime,
          "activity_API": "ical",
          "activity_API_ID": webEvents[idx].uid,
          "artists": [],
          "orig_artists": [],
          "urls": urls,
          "activity_Blurb": '',
        };
        rawArtists.push(rawArtist);
        eventObj.orig_artists.push(rawArtist);
        const cookedArtists = await artist_lookup(rawArtists, dbpool);
        for (const artiste of cookedArtists) {
          eventObj.artists.push(artiste);
          if (typeof artiste.blurb_snippet !== 'undefined') {
            eventObj.activity_Blurb = artiste.blurb_snippet;
          }
        }
        returnarr.push(eventObj);
      }
    }
    return returnarr;
  } catch (error) {
    console.error(error);
  }
  return false;
}

async function gcal_events(gcal_id, timeWindow, dbpool) {
  const returnarr = [];
  const calendar = google.calendar({
    version: 'v3',
    // All requests made with this object will use the specified auth.
    auth: conf.gcal_api_key,
  });
  const nowdt = dayjs().format();
  const enddt = dayjs().add(timeWindow, 'ms').format();
  try {
    const activities = await calendar.events.list(
      {
        calendarId: gcal_id,
        timeMin: nowdt,
        timeMax: enddt,
      });
    for (const activity of activities.data.items) {
      const rawArtist = {
        "name": activity.summary,
        "url": "",
        };
      const rawArtists = [];
      const start = activity.start.dateTime || activity.start.date;
      const startTime = dayjs(start);
      const urls = find_URLs(activity.description);
      const startDate = startTime.tz("America/New_York").format('YYYY-MM-DD');
      const activityTime = startTime.tz("America/New_York").format('HH:mm:ss');
      const timestamp = startTime.set('h',12).set('m',0).set('s',0).set('ms',0);
      const eventObj = {
        "activity_startDate": startDate,
        "activity_Time": activityTime,
        "activity_endDate": startDate,
        "activity_Timestamp": timestamp.unix(),
        "activity_timeObj": startTime,
        "activity_API": "gcal",
        "activity_API_ID": activity.id,
        "artists": [],
        "orig_artists": [],
        "urls": urls,
        "activity_Blurb": '',
      };
      rawArtists.push(rawArtist);
      eventObj.orig_artists.push(rawArtist);
      const cookedArtists = await artist_lookup(rawArtists, dbpool);
      for (const artiste of cookedArtists) {
        eventObj.artists.push(artiste);
        if (typeof artiste.blurb_snippet !== 'undefined') {
          eventObj.activity_Blurb = artiste.blurb_snippet;
        }
      }
      returnarr.push(eventObj);
    }
    return returnarr;
  } catch (error) {
    console.error(error);
  }
  return false;
}

async function jemsite(baseURL, timeWindow, dbpool) {
  try {
    const rawpage = await axios.get(baseURL);
    const $ = cheerio.load(rawpage.data);
    const mappeditems = $('.feventitem').map( async (index, element) => {
      const rawArtists = [];
      const title = $(element).find('a.newsitemtitle').html();
      let evtlink = '';
      if ($(element).find('a.newsitemtitle').attr('href') !== '/') {
        evtlink = $(element).find('a.newsitemtitle').attr('href');
      }
      const rawArtist = {
        "name": title,
        "url": evtlink,
        };
      rawArtists.push(rawArtist);
      const evtdate = $(element).find('.newsitemtitle').find('h3').html();
      const subhed = $(element).find('.newsitemtitle').find('h3:nth-of-type(2)').html();
      const timex = /(?<timelabel> <b> Time: <\/b>)(?<time>.*)(?<costlabel> <b>Cost:<\/b>)(?<cost>.*)/;
      const found = subhed.match(timex);
      let eventtime = '';
      if (found !== null) {
        eventtime = found.groups.time;
      }
      $(element).find('.newsitemtitle').find('h4').find('a').each(function(){
        const rawArtist = {
          "name": $(this).html(),
          "url": $(this).attr('href'),
          };
        rawArtists.push(rawArtist);
      });
      const eventid = crypto.createHash('md5').update(title + evtdate).digest('hex');
      const evtdateonly = evtdate.split(',')[1].trim();
      const fulldate = eventtime + ' ' + evtdateonly + ' ' + dayjs().year();
      const startTime = dayjs.tz(fulldate, 'h:mm a MMMM D YYYY', "America/New_York");
      const startDate = startTime.tz("America/New_York").format('YYYY-MM-DD');
      const activityTime = startTime.tz("America/New_York").format('HH:mm:ss');
      const timestamp = startTime.set('h',12).set('m',0).set('s',0).set('ms',0);
      const eventObj = {
        "activity_startDate": startDate,
        "activity_Time": activityTime,
        "activity_endDate": startDate,
        "activity_Timestamp": timestamp.unix(),
        "activity_timeObj": startTime,
        "activity_API": "jemsite",
        "activity_API_ID": eventid,
        "artists": [],
        "orig_artists": rawArtists,
        "urls": [],
        "activity_Blurb": '',
      };
      const cookedArtists = await artist_lookup(rawArtists, dbpool);
      for (const artiste of cookedArtists) {
        eventObj.artists.push(artiste);
        if (typeof artiste.blurb_snippet !== 'undefined') {
          eventObj.activity_Blurb = artiste.blurb_snippet;
        }
      }
      return(eventObj);
    }).get();
    const returnarr = await Promise.all(mappeditems).then(function(eventObjs){
      const finalarr = [];
      for (eventobj of eventObjs) {
        if (eventobj.activity_timeObj.isBefore(dayjs().add(timeWindow, 'ms'))){
          finalarr.push(eventobj);
        }
      }
      return finalarr;
    }).catch(function(eventObjs){ 
        console.error(eventObjs); 
    });
    return returnarr;
  } catch (error) {
    console.error(error);
  }
}

async function tribe(baseURL, timeWindow, dbpool) {
  const tribeURL = baseURL + 'events/';
  const apiURL = baseURL + 'wp-json/tribe/events/v1/events/';
  try {
    const rawpage = await axios.get(tribeURL);
    const $ = cheerio.load(rawpage.data);
    const mappeditems = $('.type-tribe_events').map( async (index, element) => {
      let postid = $(element).attr('id');
      let title = $(element).find('#eventTitle').find('h2').html();
      let subtitle = $(element).find('.eventSubHeader').html();
      if (typeof title !== 'undefined' && title !== null) {
        title = title.trim();
      } else {
        title = $(element).find('.tribe-events-list-event-title').find('a').text();
        if (typeof title !== 'undefined' && title !== null) {
          title = title.trim();
        }
      }
      if (typeof subtitle !== 'undefined' && subtitle !== null) {
        title = title + ', ' + subtitle.trim();
      } else {
        subtitle = $(element).find('.tribe-events-list-event-description').find('p').text();
        if (typeof subtitle !== 'undefined' && subtitle !== null) {
          title = title + ', ' + subtitle.trim();
        }
      }
      const eventid = postid.replace('post-', '');
      try {
        const eventdata = await axios.get(apiURL + eventid);
        const rawArtist = {
          "name": title,
          "url": "",
          };
        const rawArtists = [];
        const urls = find_URLs(subtitle);
        const startTime = dayjs.tz(eventdata.data.start_date, "America/New_York");
        const startDate = startTime.tz("America/New_York").format('YYYY-MM-DD');
        const activityTime = startTime.tz("America/New_York").format('HH:mm:ss');
        const timestamp = startTime.set('h',12).set('m',0).set('s',0).set('ms',0);
        const eventObj = {
          "activity_startDate": startDate,
          "activity_Time": activityTime,
          "activity_endDate": startDate,
          "activity_Timestamp": timestamp.unix(),
          "activity_timeObj": startTime,
          "activity_API": "tribe",
          "activity_API_ID": eventdata.data.id,
          "artists": [],
          "orig_artists": [],
          "urls": urls,
          "activity_Blurb": '',
        };
        rawArtists.push(rawArtist);
        eventObj.orig_artists.push(rawArtist);
        if (typeof eventdata.data.categories !== 'undefined' && typeof eventdata.data.categories[0] !== 'undefined' && eventdata.data.categories[0].name !== 'Show' ) {
          return {
            'skip' : true,
          };
        } else if (startTime.isAfter(dayjs().add(timeWindow, 'ms'))) {
          return {
            'skip' : true,
          };
        } else {
          const cookedArtists = await artist_lookup(rawArtists, dbpool);
          for (const artiste of cookedArtists) {
            eventObj.artists.push(artiste);
            if (typeof artiste.blurb_snippet !== 'undefined') {
              eventObj.activity_Blurb = artiste.blurb_snippet;
            }
          }
          return(eventObj);
        }
      } catch (error) {
        console.error(error);
      }
    }).get();
    const returnarr = await Promise.all(mappeditems).then(function(eventObjs){
      const finalarr = [];
      for (eventobj of eventObjs) {
        if (typeof eventobj.skip !== 'undefined' && eventobj.skip === true) {
          // do nothing
        } else {
          finalarr.push(eventobj);
        }
      }
      return finalarr;
    }).catch(function(eventObjs){ 
        console.error(eventObjs); 
    });
    return returnarr;
  } catch (error) {
    console.error(error);
  }
}

async function main() {
  const dbpool = await db.getPool();
  const main_events = [];
  const return_events = [];
  for (const venue of venues) {
    main_events[venue.venue_id] = {
      'name': venue.name,
      'events': [],
    }
    if (typeof venue.ticketmaster_id !== 'undefined') {
      for (const id of venue.ticketmaster_id) {
        const events = await ticketmaster(id, twoweeks, dbpool);
        for (const evt of events) {
          if (typeof main_events[venue.venue_id].events[`${evt.activity_Timestamp}`] === 'undefined') {
            main_events[venue.venue_id].events[`${evt.activity_Timestamp}`] = [];
          }
          evt.venue_ID = venue.venue_id;
          evt.venue_Name = venue.name;
          main_events[venue.venue_id].events[`${evt.activity_Timestamp}`].push(evt);
        }
      }
    }
    /* just using this for Tribe sites is redundant -- saving it to refactor for
    // sites that have ical links that *aren't* Tribe sites
    if (typeof venue.tribe_baseurl !== 'undefined') {
      for (const url of venue.tribe_baseurl) {
        const events = await ical_events(url, twoweeks, dbpool);
        for (const evt of events) {
          if (typeof main_events[venue.venue_id].events[`${evt.activity_Timestamp}`] === 'undefined') {
            main_events[venue.venue_id].events[`${evt.activity_Timestamp}`] = [];
          }
          evt.venue_ID = venue.venue_id;
          evt.venue_Name = venue.name;
          main_events[venue.venue_id].events[`${evt.activity_Timestamp}`].push(evt);
        }
      }
    }
    */
    if (typeof venue.gcal_id !== 'undefined') {
      for (const id of venue.gcal_id) {
        const events = await gcal_events(id, twoweeks, dbpool);
        for (const evt of events) {
          if (typeof main_events[venue.venue_id].events[`${evt.activity_Timestamp}`] === 'undefined') {
            main_events[venue.venue_id].events[`${evt.activity_Timestamp}`] = [];
          }
          evt.venue_ID = venue.venue_id;
          evt.venue_Name = venue.name;
          main_events[venue.venue_id].events[`${evt.activity_Timestamp}`].push(evt);
        }
      }
    }
    if (typeof venue.tribe_baseurl !== 'undefined') {
      for (const url of venue.tribe_baseurl) {
        const events = await tribe(url, twoweeks, dbpool);
        for (const evt of events) {
          if (typeof main_events[venue.venue_id].events[`${evt.activity_Timestamp}`] === 'undefined') {
            main_events[venue.venue_id].events[`${evt.activity_Timestamp}`] = [];
          }
          evt.venue_ID = venue.venue_id;
          evt.venue_Name = venue.name;
          main_events[venue.venue_id].events[`${evt.activity_Timestamp}`].push(evt);
        }
      }
    }
    if (typeof venue.jemsite_url !== 'undefined') {
      for (const url of venue.jemsite_url) {
        const events = await jemsite(url, twoweeks, dbpool);
        for (const evt of events) {
          if (typeof main_events[venue.venue_id].events[`${evt.activity_Timestamp}`] === 'undefined') {
            main_events[venue.venue_id].events[`${evt.activity_Timestamp}`] = [];
          }
          evt.venue_ID = venue.venue_id;
          evt.venue_Name = venue.name;
          main_events[venue.venue_id].events[`${evt.activity_Timestamp}`].push(evt);
        }
      }
    }
    if (typeof venue.etix_id !== 'undefined') {
      for (const id of venue.etix_id) {
        const events = await etix(id, twoweeks, dbpool);
        for (const evt of events) {
          if (typeof main_events[venue.venue_id].events[`${evt.activity_Timestamp}`] === 'undefined') {
            main_events[venue.venue_id].events[`${evt.activity_Timestamp}`] = [];
          }
          evt.venue_ID = venue.venue_id;          
          evt.venue_Name = venue.name;
          main_events[venue.venue_id].events[`${evt.activity_Timestamp}`].push(evt);
        }
      }
    }
    if (typeof venue.eventbrite_id !== 'undefined') {
      for (const id of venue.eventbrite_id) {
        const events = await eventbrite(id, twoweeks, dbpool);
        for (const evt of events) {
          if (typeof main_events[venue.venue_id].events[`${evt.activity_Timestamp}`] === 'undefined') {
            main_events[venue.venue_id].events[`${evt.activity_Timestamp}`] = [];
          }
          evt.venue_ID = venue.venue_id;
          evt.venue_Name = venue.name;
          main_events[venue.venue_id].events[`${evt.activity_Timestamp}`].push(evt);
        }
      }
    }
  }
  for (const venueid in main_events) {
    for (const evtday in main_events[venueid].events) {
      if (main_events[venueid].events[`${evtday}`].length === 2) {
        let api_same = 0;
        let identical = 1;
        let target_event = 1;
        let source_event = 0;
        if (main_events[venueid].events[`${evtday}`][0].activity_API === main_events[venueid].events[`${evtday}`][1].activity_API) {
          api_same = 1;
        }
        if (main_events[venueid].events[`${evtday}`][0].activity_API_ID > main_events[venueid].events[`${evtday}`][1].activity_API_ID) {
          target_event = 0;
          source_event = 1;
        }
        for (const source_artist of main_events[venueid].events[`${evtday}`][source_event].artists) {
          let found = 0;
          for (const target_artist of main_events[venueid].events[`${evtday}`][target_event].artists) {
            if (source_artist.origname === target_artist.origname) {
              found = 1;
            }
          }
          if (found === 0) {
            if (api_same === 0) {
              main_events[venueid].events[`${evtday}`][target_event].artists.push(source_artist);
            } else {
              identical = 0;
            }
          }
        }
        if (identical === 1 && api_same === 1) {
          let blurb = "Two shows: ";
          if (main_events[venueid].events[`${evtday}`][0].activity_timeObj.isAfter(main_events[venueid].events[`${evtday}`][1].activity_timeObj)) {
            blurb += main_events[venueid].events[`${evtday}`][1].activity_timeObj.tz("America/New_York").format('h:mma') + " & " + main_events[venueid].events[`${evtday}`][0].activity_timeObj.tz("America/New_York").format('h:mma');
          } else {
            blurb += main_events[venueid].events[`${evtday}`][0].activity_timeObj.tz("America/New_York").format('h:mma') + " & " + main_events[venueid].events[`${evtday}`][1].activity_timeObj.tz("America/New_York").format('h:mma');
          }
          main_events[venueid].events[`${evtday}`][target_event].activity_Blurb = blurb;
          const removed = main_events[venueid].events[`${evtday}`].splice(source_event, 1);
          return_events.push(main_events[venueid].events[`${evtday}`][target_event]);
        } else if (api_same === 0) {
          const removed = main_events[venueid].events[`${evtday}`].splice(source_event, 1);
          return_events.push(main_events[venueid].events[`${evtday}`][0]);
        } else {
          return_events.push(main_events[venueid].events[`${evtday}`][target_event]);
          return_events.push(main_events[venueid].events[`${evtday}`][source_event]);
        }
      } else {
        for (eventobj of main_events[venueid].events[`${evtday}`]){
          return_events.push(eventobj);
        }
      }
    }
  }
  const shows = await dblookup_shows(dbpool, 'object');
  for (const idx in return_events) {
    if (typeof return_events[idx] !== 'undefined') {
      const lookup = return_events[idx].activity_API_ID;
      if (typeof shows[`${lookup}`] !== 'undefined') {
        return_events[idx].dbevent = shows[`${lookup}`];
        delete shows[`${lookup}`];
      }
    }
  }
 // for (const prop in shows) {
    //console.log('this is what is left in db but not found via the apis:');
    //console.log(util.inspect(shows, true, 7, true));
 // }
  return return_events;
}

//currently we pass in req.body
async function events_add_json(bodyObj) {
  for (const activity of bodyObj.events) {
    console.log("looping thru activities");
    console.log(util.inspect(activity, true, 5, true));
    if (typeof activity.keep !== 'undefined' && activity.keep === 'yes') {
      const artists = [];
      const evtObj = {
        'table': 'activity',
        'fields': {
          "activity_startDate": activity.activity_startDate,
          "activity_Time": activity.activity_Time,
          "activity_endDate": activity.activity_startDate,
          "activity_API_ID": activity.activity_API_ID,
          "activity_API": activity.activity_API,
          "activity_venueID": activity.activity_venueID,
          "activity_Blurb": activity.blurb,
        }
      }
      if(typeof activity.existing_artists !== 'undefined'){
        for (const exartist of activity.existing_artists) {
          if (exartist && typeof exartist !== 'null' && typeof exartist !== 'undefined') {
            artists.push(exartist);
          }
        }
      }
      for (const newartist of activity.new_artists) {
        if (newartist && typeof newartist !== 'null' && typeof newartist !== 'undefined') {
          if (typeof newartist.addone !== 'undefined' && newartist.addone === 'add') {
            const insertobj = {
              'table': 'actor',
              'fields': {
                'actor_Name': newartist.artist_name,
                'actor_Local': 'no',
                'actor_Defunct': 'no',
              }
            };
            try {
              const result = await dbinsert(insertobj);
              const actor_id = result[0].insertId;
              artists.push({artistid: actor_id});
            } catch (error) {
              console.error(error);
              return false;
            }
          }
        }
      }
      try {
        const result = await dbinsert(evtObj);
        const activity_id = result[0].insertId;
        for (const artist of artists) {
          const activityobj = {
            'table': 'actlink',
            'fields': {
              'actlink_ActorID': artist.artistid,
              'actlink_ActivityID': activity_id,
              },
          };
          try {
            const result = await dbinsert(activityobj);
          } catch (error) {
            console.error(error);
            return false;
          }
        }
      } catch (error) {
        console.error(error);
        return false;
      }
    }
  }
  console.log("done, about to return true");
  return true;
}

module.exports = { main, events_add_json, dblookup_shows };
