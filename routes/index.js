const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser');
const { main } = require('./api_clients');
const util = require('util');

// create application/json parser
const jsonParser = bodyParser.json()

// create application/x-www-form-urlencoded parser
const urlencodedParser = bodyParser.urlencoded({ extended: true })

const duration = 1814400000; // 3 weeks

router.get('/', async function(req, res, next) {
  const renderObj = {
    title: 'First Pass!',
  }
  res.render('index', renderObj);
});

router.post('/events-add', urlencodedParser, async function(req, res, next) {
  console.log(util.inspect(req.body, true, 8, true));
  const renderObj = {
    title: 'First Pass!',
  }
  res.render('index', renderObj);
});

router.get('/events', async function(req, res, next) {
  const events = await main();
  const renderObj = {
    events: events,
  }
  console.log(util.inspect(events, true, 7, true));
  res.render('events', renderObj);
});

module.exports = router;
