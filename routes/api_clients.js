const axios = require('axios');
const dayjs = require('dayjs');
const util = require('util');

const conf = require('../config');
const { venues } = require('../venues');
const db = require('../db');

const duration = 1814400000; // 3 weeks

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

async function artist_lookup(artists, dbpool) {
  const returnarr = [];
  for (artist of artists) {
    let blurb_snippet = '';
    const reg1 = /an evening with/ig;
    const reg2 = / \(.*\)$/i;
    const reg3 = /(vinyl)* album release (party|show)*/i;
    const reg4 = / and /ig;
    const reg5 = / & /ig;
    const reg6 = /\//ig;
    const reg7 = / with /ig;
    const reg8 = /\W$/;
    const reg9 = /^(A |An |The )/i;
    const reg10 = /and friends/gi;
    const reg11 = /special guest(s)*/gi;
    const reg12 = /\s{1}[b-zB-z]{1}\s{1}/g;
    const reg13 = /featuring/gi;
    const reg14 = /:/g;
    const reg15 = / more(\W)?$/i;
    const reg16 = /(?<blurb>in the record shop)/i;
    let name1 = artist.name.replace(reg1,'');
    name1 = name1.replace(reg10,' ');
    name1 = name1.replace(reg12, ', ');
    name1 = name1.replace(reg13, ', ');
    name1 = name1.replace(reg15, '');
    name1 = name1.replace(reg9,'');
    name1 = name1.replace(reg2,'');
    name1 = name1.replace(reg3,' ');
    name1 = name1.replace(reg4,', ');
    name1 = name1.replace(' w/', ', ');
    name1 = name1.replace(reg7, ', ');
    name1 = name1.replace(reg11,'');
    name1 = name1.replace(reg5, ', ');
    name1 = name1.replace(reg6, ', ');
    name1 = name1.replace(reg8,'');
    name1 = name1.replace(reg14,', ');
    const found = name1.match(reg16);
    if (found !== null) {
      blurb_snippet = found.groups.blurb;
      name1 = name1.replace(reg16, '');
    }
    const parts = name1.split(',');
    const candidates = {
      'url': artist.url,
      'names': [],
    };
    for (const part of parts) {
      const candidate = part.trim();
      const falses = [];
      const trues = [];
      if (candidate.length > 2) {
        const dbartist = await dblookup(candidate, dbpool);
        if (typeof dbartist === 'undefined' || dbartist.length === 0) {
          const candobj = {
            'origname': candidate,
            'dbname': '',
            'id': '',
            'best': false,
            'blurb_snippet': blurb_snippet,
          };
          falses.push(candobj);
        } else if (dbartist.length >= 1) {
          for (artobj of dbartist) {
            if (artobj.actor_Name.toLowerCase() === candidate.toLowerCase()) {
              const candobj = {
                'origname': candidate,
                'dbname': artobj.actor_Name,
                'id': artobj.actor_ID,
                'best': true,
                'blurb_snippet': blurb_snippet,
              };
              trues.push(candobj);
            } else {
              const candobj = {
                'origname': candidate,
                'dbname': artobj.actor_Name,
                'id': artobj.actor_ID,
                'best': false,
                'blurb_snippet': blurb_snippet,
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
        };
        falses.push(candobj);
      }
      if (trues.length > 0) {
        for (const tru of trues) {
          candidates.names.push(tru);
        }
      } else {
        for (const fals of falses) {
          candidates.names.push(fals);
        }
      }
    }
    returnarr.push(candidates);
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
      if (typeof activity.status !== 'undefined' && activity.status !== "notOnSale" && activity.activityType === "performance" && activity.category === "Concerts") {
        let endDate;
        if (typeof activity.endTime !== 'undefined' && activity.endTime !== '') {
          endDate = dayjs(activity.endTime);
        } else {
          endDate = dayjs(activity.startTime);
        }
        const startTime = dayjs(activity.startTime);
        const timestamp = startTime.set('h',12).set('m',0).set('s',0).set('ms',0);
        const rawArtists = [];
        const event = {
          "activity_Timestamp": timestamp.unix(),
          "activity_StartTime": startTime,
          "activity_EndDate": endDate,
          "activity_API": "etix",
          "activity_API_ID": activity.id,
          "orig_artists": [],
          "artists": [],
        }
        if (typeof activity.performers[0] !== 'undefined') {
          for (const performer of activity.performers) {
            const artist = {
              "name": performer.name,
              "url": performer.linkURL,
            }
            event.orig_artists.push(artist);
            rawArtists.push(artist);
          }
        }
        const artist = {
          "name": activity.name,
          "url": "",
        }
        event.orig_artists.push(artist);
        rawArtists.push(artist);
        const cookedArtists = await artist_lookup(rawArtists, dbpool);
        for (artiste of cookedArtists) {
          event.artists.push(artiste);
        }
        returnarr.push(event);
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
    const events = [];
    for (const event of response.data.events) {
      if(typeof event.status !== 'undefined' && event.status === 'live') {
        const endDate = dayjs(event.end.local);
        const startTime = dayjs(event.start.local);
        const timestamp = startTime.set('h',12).set('m',0).set('s',0).set('ms',0);
        const rawArtist = {
            "name": event.name.text,
            "url": "",
          };
        const rawArtists = [];
        const eventObj = {
          "activity_API": "eventbrite",
          "activity_API_ID": event.id,
          "activity_Timestamp": timestamp.unix(),
          "activity_StartTime": startTime,
          "activity_EndDate": endDate,
          "orig_artists": [],
          "artists": [],
        };
        eventObj.orig_artists.push(rawArtist);
        rawArtists.push(rawArtist);
        const cookedArtists = await artist_lookup(rawArtists, dbpool);
        for (artiste of cookedArtists) {
          eventObj.artists.push(artiste);
        }
        events.push(eventObj);
      }
    }
    return events;
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
    await sleep(300);
    const events = [];
    if (typeof response.data._embedded !== 'undefined') {
      for (const event of response.data._embedded.events) {
        if (typeof event.dates.status.code !== 'undefined' && event.dates.status.code !== 'cancelled' && typeof event.classifications !== 'undefined' && event.classifications[0].segment.name === 'Music') {
          const rawArtist = {
            "name": event.name,
            "url": "",
            };
          const rawArtists = [];
          const timestamp = dayjs(event.dates.start.localDate+"T12:00:00.000Z");
          const startTime = dayjs(event.dates.start.localDate+"T"+event.dates.start.localTime+"-0500");
          const thisEvent = {
            "activity_StartTime": startTime,
            "activity_Timestamp": timestamp.unix(),
            "activity_EndDate": startTime,
            "activity_API": "ticketmaster",
            "activity_API_ID": event.id,
            "artists": [],
            "orig_artists": [],
          }
          rawArtists.push(rawArtist);
          thisEvent.orig_artists.push(rawArtist);
          const cookedArtists = await artist_lookup(rawArtists, dbpool);
          for (artiste of cookedArtists) {
            thisEvent.artists.push(artiste);
          }
          events.push(thisEvent);
        }
      }
    }
    return events;
  } catch (error) {
    console.error(error);
  }
}

async function main() {
  const dbpool = await db.getPool();
  const main_events = [];
  for (const venue of venues) {
    main_events[venue.venue_id] = {
      'name': venue.name,
      'events': [],
    }
    if (typeof venue.ticketmaster_id !== 'undefined') {
      for (const id of venue.ticketmaster_id) {
        const events = await ticketmaster(id, duration, dbpool);
        for (const evt of events) {
          if (typeof main_events[venue.venue_id].events[evt.activity_Timestamp] === 'undefined') {
            main_events[venue.venue_id].events[evt.activity_Timestamp] = [];
          }
          evt.venue_ID = venue.venue_id;
          main_events[venue.venue_id].events[evt.activity_Timestamp].push(evt);
        }
      }
    }
    if (typeof venue.etix_id !== 'undefined') {
      for (const id of venue.etix_id) {
        const events = await etix(id, duration, dbpool);
        for (const evt of events) {
          if (typeof main_events[venue.venue_id].events[evt.activity_Timestamp] === 'undefined') {
            main_events[venue.venue_id].events[evt.activity_Timestamp] = [];
          }
          evt.venue_ID = venue.venue_id;
          main_events[venue.venue_id].events[evt.activity_Timestamp].push(evt);
        }
      }
    }
    if (typeof venue.eventbrite_id !== 'undefined') {
      for (const id of venue.eventbrite_id) {
        const events = await eventbrite(id, duration, dbpool);
        for (const evt of events) {
          if (typeof main_events[venue.venue_id].events[evt.activity_Timestamp] === 'undefined') {
            main_events[venue.venue_id].events[evt.activity_Timestamp] = [];
          }
          evt.venue_ID = venue.venue_id;
          main_events[venue.venue_id].events[evt.activity_Timestamp].push(evt);
        }
      }
    }
  }
  for (const venueid in main_events) {
    for (const evtday in main_events[venueid].events) {
      if (main_events[venueid].events[evtday].length === 2) {
        console.log('2 on this day, heres what we start with:\n');
        console.log(util.inspect(main_events[venueid].events[evtday], true, 5, true));
        let api_same = 0;
        let identical = 1;
        let target_event = 1;
        let source_event = 0;
        if (main_events[venueid].events[evtday][0].activity_API === main_events[venueid].events[evtday][1].activity_API) {
          api_same = 1;
        };
        if (main_events[venueid].events[evtday][0].activity_API_ID > main_events[venueid].events[evtday][1].activity_API_ID) {
          target_event = 0;
          source_event = 1;
        }
        for (const source_artist of main_events[venueid].events[evtday][source_event].artists) {
          let found = 0;
          for (const target_artist of main_events[venueid].events[evtday][target_event].artists) {
            if (source_artist.origname === target_artist.origname) {
              found = 1;
            }
          }
          if (found === 0) {
            if (api_same === 0) {
              main_events[venueid].events[evtday][target_event].artists.push(source_artist);
            } else {
              identical = 0;
            }
          }
        }
        if (identical === 1 && api_same === 1) {
          // merge, delete, add blurb with the 2 times
          let blurb = "Two shows: ";
          if (main_events[venueid].events[evtday][0].activity_StartTime.isAfter(main_events[venueid].events[evtday][1].activity_StartTime)) {
            blurb += main_events[venueid].events[evtday][1].activity_StartTime.format('h:mma') + " & " + main_events[venueid].events[evtday][0].activity_StartTime.format('h:mma');
          } else {
            blurb += main_events[venueid].events[evtday][0].activity_StartTime.format('h:mma') + " & " + main_events[venueid].events[evtday][1].activity_StartTime.format('h:mma');
          }
          main_events[venueid].events[evtday][target_event].activity_Blurb = blurb;
          const removed = main_events[venueid].events[evtday].splice(source_event, 1);
        } else if (api_same === 0) {
          const removed = main_events[venueid].events[evtday].splice(source_event, 1);
        }
        console.log('2 on this day, heres what we wound up with:\n');
        console.log(util.inspect(main_events[venueid].events[evtday], true, 5, true));
      } else {
        console.log('either 1 or 3 on this day, leaving alone either way\n')
        console.log(util.inspect(main_events[venueid].events[evtday], true, 5, true));
      }
    }
  }
}

/*
          "activity_Time": startDate.format('HH:mm:ss'),
          "activity_StartDate": startDate.format('YYYY-MM-DD'),
          "activity_EndDate": endDate.format('YYYY-MM-DD'),
*/


main();