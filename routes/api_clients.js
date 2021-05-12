const axios = require('axios');
const dayjs = require('dayjs');
const util = require('util');

const conf = require('../config');
const { venues } = require('../venues');
const duration = 1814400000; // 3 weeks

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function artist_lookup(artists) {
  const returnarr = [];
  for (artist of artists) {
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
    for (part of parts) {
      const candidate = part.trim();
      if (candidate !== '') {
        returnarr.push(candidate);
      }
    }
  }
  return returnarr;
}

async function etix(venueID, timeWindow) {
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
            event.artists.push(artist);
          }
        }
        const artist = {
          "name": activity.name,
          "url": "",
        }
        event.artists.push(artist);
        returnarr.push(event);
      }
    }
    return returnarr;
  } catch (error) {
    console.error(error);
  }
}

async function eventbrite(venueID, timeWindow) {
  const ebrite_url_prefix = "https://www.eventbriteapi.com/v3/venues/";
  const ebrite_url_suffix = "/events/?status=live";
  const ebrite_url = ebrite_url_prefix + venueID + ebrite_url_suffix;
  const config = {
    headers: { Authorization: "Bearer "+conf.eventbrite_api_key },
  };

  try {
    const response = await axios.get(ebrite_url, config);
    const events = [];
    response.data.events.forEach( (event) => {
      if(typeof event.status !== 'undefined' && event.status === 'live') {
        const endDate = dayjs(event.end.local);
        const startDate = dayjs(event.start.local);
        const eventObj = {
          "activity_API": "eventbrite",
          "activity_API_ID": event.id,
          "activity_Time": startDate.format('HH:mm:ss'),
          "activity_StartDate": startDate.format('YYYY-MM-DD'),
          "activity_EndDate": endDate.format('YYYY-MM-DD'),
          "artists": [
            {
              "name": event.name.text,
              "url": "",
            },
          ],
        };
        events.push(eventObj);
      }
    })
    return events;
  } catch (error) {
    console.error(error);
  }
}

async function ticketmaster(venueID, timeWindow) {
  const endDate = dayjs().add(timeWindow, 'ms').format('YYYY-MM-DDTHH:mm:ss[Z]');
  const ticketmaster_url_prefix = "http://app.ticketmaster.com/discovery/v2/events.json?apikey="+conf.ticketmaster_api_key+"&venueId=";
  const ticketmaster_url_suffix = "&size=40&sort=date,asc&endDateTime=" + endDate;
  const ticketmaster_url = ticketmaster_url_prefix + venueID + ticketmaster_url_suffix;

  try {
    const response = await axios.get(ticketmaster_url);
    await sleep(300);
    const events = [];
    if (typeof response.data._embedded !== 'undefined') {
      response.data._embedded.events.forEach( (event) => {
        if (typeof event.dates.status.code !== 'undefined' && event.dates.status.code !== 'cancelled') {
          const thisEvent = {
            "activity_Time": event.dates.start.localTime,
            "activity_StartDate": event.dates.start.localDate,
            "activity_EndDate": event.dates.start.localDate,
            "activity_API": "ticketmaster",
            "activity_API_ID": event.id,
            "artists": [
                {
                    "name": event.name,
                    "url": "",
                }
            ]
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
  const main_events = [];
  for (const venue of venues) {
    if (typeof venue.ticketmaster_id !== 'undefined') {
      for (const id of venue.ticketmaster_id) {
        const events = await ticketmaster(id, duration);
        for (const evt of events) {
          evt.venue_ID = venue.venue_id;
          main_events.push(evt);
        }
      }
    }
    if (typeof venue.etix_id !== 'undefined') {
      for (const id of venue.etix_id) {
        const events = await etix(id, duration);
        for (const evt of events) {
          evt.venue_ID = venue.venue_id;
          main_events.push(evt);
        }
      }
    }
    if (typeof venue.eventbrite_id !== 'undefined') {
      for (const id of venue.eventbrite_id) {
        const events = await eventbrite(id, duration);
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
    }
    newActivity.activity_Artists = await artist_lookup(evt.artists);
    console.log(util.inspect(newActivity, true, 7, true));
  }

}

main();