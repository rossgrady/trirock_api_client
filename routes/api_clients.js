const axios = require('axios');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone'); // dependent on utc plugin
dayjs.extend(utc);
dayjs.extend(timezone);
const util = require('util');
const namecase = require('namecase');
const ical = require('node-ical');
const cheerio = require('cheerio');
const {google} = require('googleapis');

const conf = require('../config');
const { venues } = require('../venues');
const db = require('../db');

const duration = 1814400000; // 3 weeks in ms

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

async function dblookup(namestring, dbpool) {
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

async function dbinsert(insertObj) {
  // insertOjb = {
  //   'table': table-to-insert-into,
  //   'fields': {
  //      'column': 'value',
  //    }
  //  }  
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
  console.log(statement);
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
        const dbartist = await dblookup(candidate, dbpool);
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

// it's just description

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
      if (typeof activity.status !== 'undefined' && activity.status !== "notOnSale" && activity.activityType === "performance" && activity.category === "Concerts" && startTime.isBefore(dayjs().add(timeWindow, 'ms'))) {
        const timestamp = startTime.set('h',12).set('m',0).set('s',0).set('ms',0);
        const startDate = startTime.tz("America/New_York").format('YYYY-MM-DD');
        const activityTime = startTime.tz("America/New_York").format('HH:mm:ss');
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

// it's description.text

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

// looks like it's just info
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
      if (webEvents[idx].type === 'VEVENT' && startTime.isAfter(dayjs())) {
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
    auth: conf.api_key,
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
        const startTime = dayjs(eventdata.data.utc_start_date);
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
        const events = await ticketmaster(id, duration, dbpool);
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
        const events = await ical_events(url, duration, dbpool);
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
        const events = await gcal_events(id, duration, dbpool);
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
        const events = await tribe(url, duration, dbpool);
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
        const events = await etix(id, duration, dbpool);
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
        const events = await eventbrite(id, duration, dbpool);
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
        };
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
          return_events.push(main_events[venueid].events[`${evtday}`][target_event]);
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
  return return_events;
}

async function events_add(bodyObj) {
  for (const activity of bodyObj.events) {
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
      console.log('going to try to insert this activity: ' + util.inspect(evtObj, true, 8, true));
      if(typeof activity.existing_artists !== 'undefined'){
        for (const exartist of activity.existing_artists) {
          artists.push(exartist);
        }
      }
      for (const newartist of activity.new_artists) {
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
          // call artists insert & add the new artist
          // in actor:
          // actor_Name
          // actor_Twitter -- not gonna implement this yet! Need a whole Twitter client!
          // actor_Local --> no (default is yes)
          // actor_Defunct --> no (default is yes)
          // actor_BestURL --> foreign key to:
          // actorlinks
          // actorlinks_ActorID --> the actor_ID we get after inserting a new actor
          // actorlinks_ID --> auto increment, we need it to insert into actor_BestURL
          // actorlinks_URL --> the URL
          // actorlinks_Name --> if it's Bandcamp, I have been doing "actorname at Bandcamp"
          // get the artist ID back
        }
      }
      try {
        const result = await dbinsert(evtObj);
        const activity_id = result[0].insertId;
        console.log('hopefully inserted the event & got this back: ' + activity_id);
        for (const artist of artists) {
          const activityobj = {
            'table': 'actlink',
            'fields': {
              'actlink_ActorID': artist.artistid,
              'actlink_ActivityID': activity_id,
              },
          };
          console.log('trying to insert this obj: ' + util.inspect(activityobj, true, 8, true));
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
  return true;
}

module.exports = { main, events_add, ical_events, tribe };
