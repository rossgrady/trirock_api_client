const conf = require('../config');
const axios = require('axios');
const dayjs = require('dayjs');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* each client should return a datastructure like this:
events = [
  {
    activity_Time: 
    activity_Blurb:
    activity_VenueID (ours, not the API's): 
    activity_StartDate: 
    activity_EndDate: 
    activity_API: 
    activity_API_ID: 
    artists: [ // this can be a single string if that's all we get
        {
            name: 
            url:
        }
    ]
  }
]
*/

const venues = [
    {
        "name": "Duke Coffeehouse",
        "venue_id": "10",
    },
    {
        "name": "Baldwin Auditorium",
        "venue_id": "230",
    },
    {
        "name": "Arcana",
        "venue_id": "229",
    },
    {
        "name": "Nightlight",
        "venue_id": "78",
    },
    {
        "name": "The Kraken",
        "venue_id": "192",
    },
    {
        "name": "Slim's",
        "venue_id": "105",
    },
    {
      "ticketmaster_id": ["KovZpZAdakJA"],
      "name": "PNC Arena",
      "venue_id": "218",
    },
    {
      "ticketmaster_id": ["KovZpa2X8e"],
      "name": "DPAC",
      "venue_id": "146",
    },
    {
      "ticketmaster_id": ["KovZpZAEkeaA"],
      "name": "Walnut Creek",
      "venue_id": "204",
    },
    {
      "ticketmaster_id": ["KovZpZAJIedA"],
      "name": "The Ritz",
      "venue_id": "6",
    },
    {
      "ticketmaster_id": ["KovZpZAFF1nA"],
      "name": "Duke Energy Center",
      "venue_id": undefined,
    },
    {
      "ticketmaster_id": ["KovZpZAdEEvA"],
      "name": "Red Hat Amphiteatre",
      "venue_id": "187",
    },
    {
        "eventbrite_id": ["26022174"],
        "name": "Neptunes",
        "venue_id": "202",
    },
    {
        "eventbrite_id": ["38009195"],
        "ticketmaster_id": ["KovZpZAFAl6A"],
        "name": "Carolina Theatre",
        "venue_id": "57",
    },
    {
        "eventbrite_id": ["36059139", "31245252"],
        "name": "The Pinhook",
        "venue_id": "141",
    },
    {
        "eventbrite_id": ["28011438", "34919439"],
        "name": "Motorco Music Hall",
        "venue_id": "180",
    },
    {
        "eventbrite_id": ["40815003"],
        "name": "PS37",
        "venue_id": "249",
    },
    {
        "eventbrite_id": ["56939487"],
        "name": "Orange County Speedway",
        "venue_id": undefined,
    },
    {
        "eventbrite_id": ["58314985"],
        "name": "Oddco",
        "venue_id": undefined,
    },
    {
        "etix_id": ["1309", "12884", "14674", "1285"],
        "eventbrite_id": ["33175485", "44427049"],
        "name": "Local 506",
        "venue_id": 3,
    },
    {
        "etix_id": ["8396"],
        "ticketmaster_id": ["KovZpZAIAnkA"],
        "name": "Cary's Koka Booth Amphitheatre",
        "venue_id": 203,
    },
    {
        "etix_id": ["8288"],
        "ticketmaster_id": ["ZFr9jZ1kae"],
        "name": "North Carolina Museum of Art: Museum Park Theater",
        "venue_id": 37,
    },
    {
        "etix_id": ["45"],
        "name": "Lincoln Theatre",
        "venue_id": 45,
    },
    {
        "etix_id": ["223"],
        "eventbrite_id": ["25818574", "35370429"],
        "name": "Kings",
        "venue_id": 1,
    },
    {
        "etix_id": ["11336"],
        "eventbrite_id": ["25398167", "35688649", "35595755", "35521815", "35295301", "35685357", "43529989"],
        "name": "The Pour House Music Hall",
        "venue_id": 93,
    },
    {
        "etix_id": ["35"],
        "eventbrite_id": ["59182129"],
        "name": "Cat's Cradle",
        "venue_id": 2,
    },
    {
        "etix_id": ["11955"],
        "name": "Cat's Cradle - Back Room",
        "venue_id": 207,
    },
    {
        "etix_id": ["11695"],
        "name": "The Blue Note Grill",
        "venue_id": 231,
    },
    {
        "etix_id": ["10926"],
        "name": "The Cave",
        "venue_id": 5,
    },
    {
        "etix_id": ["12128"],
        "name": "Ruby Deluxe",
        "venue_id": 223,
    },
    {
        "etix_id": ["36"],
        "name": "The ArtsCenter",
        "venue_id": 26,
    },
    {
        "etix_id": ["12088"],
        "eventbrite_id": ["33823692"],
        "name": "Haw River Ballroom",
        "venue_id": 188,
    },
];

async function etix(timeWindow) {
  const etix_url = "https://api.etix.com/v1/public/activities?venueIds=";
  const config = {
    headers: {apiKey: conf.etix_api_key},
  };

  try {
    const response = await axios.get(etix_url, config);
    return response.data;
  } catch (error) {
    console.error(error);
  }
}

async function eventbrite(timeWindow) {

  const config = {
    headers: { Authorization: "Bearer "+eventbrite_api_key },
  };

  const ebrite_url_prefix = "https://www.eventbriteapi.com/v3/venues/";
  const ebrite_url_suffix = "/events/?status=live";

  const returnArr = [];

  for (const venue of eventbrite_venues) {
    const ebrite_url = ebrite_url_prefix + venue.id + ebrite_url_suffix;
    const venueObj = {
      "name": venue.name,
      "id": venue.id,
      "events": [],
    };
    try {
      const response = await axios.get(ebrite_url, config);
      response.data.events.forEach( (event) => {
        const eventObj = {
          "name": event.name,
          "description": event.description,
          "id": event.id,
          "start": event.start,
          "end": event.end,
        };
        venueObj.events.push(eventObj);
      })
      returnArr.push(venueObj);
    } catch (error) {
      console.error(error);
    }
  }
  
  console.log(returnArr);
  return returnArr;
}

async function ticketmaster(timeWindow) {
  const endDate = dayjs().add(timeWindow, 'ms').format('YYYY-MM-DDTHH:mm:ss[Z]');
  const ticketmaster_url_prefix = "http://app.ticketmaster.com/discovery/v2/events.json?apikey="+ticketmaster_api_key+"&venueId=";
  const ticketmaster_url_suffix = "&size=40&sort=date,asc&endDateTime=" + endDate;
 
  const returnArr = [];

  for (const venue of ticketmaster_venues) {
    const ticketmaster_url = ticketmaster_url_prefix + venue.id + ticketmaster_url_suffix;
    const venueObj = {
      "name": venue.name,
      "id": venue.id,
      "events": [],
    };
    try {
      const response = await axios.get(ticketmaster_url);
      await sleep(300);
      response.data._embedded.events.forEach( (event) => {
	console.log(event);
       // const eventObj = {
       //   "name": event.name,
       //   "description": event.description,
       //   "id": event.id,
       //   "start": event.start,
       //   "end": event.end,
       // };
       // venueObj.events.push(eventObj);
      })
      returnArr.push(venueObj);
    } catch (error) {
      console.error(error);
    }
  }
  
  console.log(returnArr);
  return returnArr;
}

module.exports = { etix, eventbrite, ticketmaster };

