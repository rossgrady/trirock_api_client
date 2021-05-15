const axios = require('axios');
const dayjs = require('dayjs');
const util = require('util');

const conf = require('../config');
const { venues } = require('../venues');
const { getPool, query, end } = require('../db');

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
  const rows = await query(dbpool, querystring);
  if (typeof rows !== 'undefined') {
    return rows;
  } else {
    const nullarr = [];
    return nullarr;
  }
}

async function artist_lookup(artists, dbpool) {
  const returnobj = {
    'returnarr': [],
    'origarr': [],
  };
  for (artist of artists) {
    returnobj.origarr.push(artist);
    const reg1 = /an evening with/ig;
    const reg2 = /\(\d+.*\)/ig;
    const reg3 = /[vinyl]* album release [party|show]*/i;
    const reg4 = / and /ig;
    const reg5 = / & /ig;
    const reg6 = / \//ig;
    const reg7 = / with /ig;
    let name1 = artist.name.replace(reg1,'');
    name1 = name1.replace(reg2,'');
    name1 = name1.replace(reg3,'');
    name1 = name1.replace(reg4,', ');
    name1 = name1.replace(' w/', ', ');
    name1 = name1.replace(reg7, ', ');
    name1 = name1.replace(reg5, ', ');
    name1 = name1.replace(reg6, ', ');
    const parts = name1.split(',');
    const candidates = {
      'url': artist.url,
      'names': [],
    };
    for (part of parts) {
      const candidate = part.trim();
      if (candidate !== '') {
        const dbartist = await dblookup(candidate, dbpool);
        const candobj = {
          'origname': candidate,
          'dbname': '',
          'id': '',
          'best': false,
        };
        if (dbartist.length === 1) {
          candobj.dbname = dbartist.actor_Name;
          candobj.id = dbartist.actor_ID;
          candobj.best = true;
          candidates.names.push(candobj);
        } else if (dbartist.length > 1) {
          // ooooh fun
          for (artobj of dbartist) {
            if (artobj.actor_Name === candidate) {
              candobj.dbname = artobj.actor_Name;
              candobj.id = artobj.actor_ID;
              candobj.best = true;
              candidates.names.push(candobj);
            } else {
              candobj.dbname = artobj.actor_Name;
              candobj.id = artobj.actor_ID;
              candidates.names.push(candobj);
            }
          }
        }
      }
    }
    returnobj.returnarr.push(candidates);
  }
  console.log(util.inspect(returnobj, true, 7, true));
  return returnobj;
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
      if (typeof activity.status !== 'undefined' && activity.status !== "notOnSale") {
        let endDate;
        if (typeof activity.endTime !== 'undefined' && activity.endTime !== '') {
          endDate = dayjs(activity.endTime);
        } else {
          endDate = dayjs(activity.startTime);
        }
        const startDate = dayjs(activity.startTime);
        const rawArtists = [];
        const event = {
          "activity_Time": startDate.format('HH:mm:ss'),
          "activity_StartDate": startDate.format('YYYY-MM-DD'),
          "activity_EndDate": endDate.format('YYYY-MM-DD'),
          "activity_API": "etix",
          "activity_API_ID": activity.id,
          "artists": [],
        }
        if (typeof activity.performers[0] !== 'undefined') {
          for (const performer of activity.performers) {
            const artist = {
              "name": performer.name,
              "url": performer.linkURL,
            }
            rawArtists.push(artist);
          }
        }
        const artist = {
          "name": activity.name,
          "url": "",
        }
        rawArtists.push(artist);
        const cookedArtists = await artist_lookup(rawArtists, dbpool);
        for (artiste of cookedArtists.returnarr) {
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
    response.data.events.forEach( async (event) => {
      if(typeof event.status !== 'undefined' && event.status === 'live') {
        const endDate = dayjs(event.end.local);
        const startDate = dayjs(event.start.local);
        const rawArtists = [
          {
            "name": event.name.text,
            "url": "",
          },
        ];
        const eventObj = {
          "activity_API": "eventbrite",
          "activity_API_ID": event.id,
          "activity_Time": startDate.format('HH:mm:ss'),
          "activity_StartDate": startDate.format('YYYY-MM-DD'),
          "activity_EndDate": endDate.format('YYYY-MM-DD'),
          "artists": [],
        };
        const cookedArtists = await artist_lookup(rawArtists, dbpool);
        for (artiste of cookedArtists. returnarr) {
          eventObj.artists.push(artiste);
        }
        events.push(eventObj);
      }
    })
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
      response.data._embedded.events.forEach( async (event) => {
        if (typeof event.dates.status.code !== 'undefined' && event.dates.status.code !== 'cancelled') {
          const rawArtists = [                
            {
            "name": event.name,
            "url": "",
            },
          ];
          const cookedArtists = await artist_lookup(rawArtists, dbpool);
          const thisEvent = {
            "activity_Time": event.dates.start.localTime,
            "activity_StartDate": event.dates.start.localDate,
            "activity_EndDate": event.dates.start.localDate,
            "activity_API": "ticketmaster",
            "activity_API_ID": event.id,
            "artists": [],
          }
          for (artiste of cookedArtists.returnarr) {
            thisEvent.artists.push(artiste);
          }
          events.push(thisEvent);
        }
      })
    }
    return events;
  } catch (error) {
    console.error(error);
  }
}

async function main() {
  const dbpool = await getPool();
  const main_events = [];
  for (const venue of venues) {
    if (typeof venue.ticketmaster_id !== 'undefined') {
      for (const id of venue.ticketmaster_id) {
        const events = await ticketmaster(id, duration, dbpool);
        for (const evt of events) {
          evt.venue_ID = venue.venue_id;
          main_events.push(evt);
        }
      }
    }
    if (typeof venue.etix_id !== 'undefined') {
      for (const id of venue.etix_id) {
        const events = await etix(id, duration, dbpool);
        for (const evt of events) {
          evt.venue_ID = venue.venue_id;
          main_events.push(evt);
        }
      }
    }
    if (typeof venue.eventbrite_id !== 'undefined') {
      for (const id of venue.eventbrite_id) {
        const events = await eventbrite(id, duration, dbpool);
        for (const evt of events) {
          evt.venue_ID = venue.venue_id;
          main_events.push(evt);
        }
      }
    }
  }
  for (const evt of main_events) {
    const newActivity = {
      'activity_VenueID': evt.venue_ID,
      'activity_Time': evt.activity_Time,
      'activity_StartDate': evt.activity_StartDate,
      'activity_EndDate': evt.activity_EndDate,
      'activity_API': evt.activity_API,
      'activity_API_ID': evt.activity_API_ID,
      'artists': evt.artists,
    }
    console.log(util.inspect(newActivity, true, 7, true));
  }

}

main();