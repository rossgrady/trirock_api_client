const express = require('express');
const router = express.Router();
const { main, events_add } = require('./api_clients');
const util = require('util');

const duration = 1814400000; // 3 weeks

router.get('/', async function(req, res, next) {
  const renderObj = {
    title: 'First Pass!',
  }
  res.render('index', renderObj);
});

router.post('/events-add', async function(req, res, next) {
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
  res.render('events', renderObj);
});

module.exports = router;
