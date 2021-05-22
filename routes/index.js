const express = require('express');
const router = express.Router();
const { etix, eventbrite, ticketmaster } = require('./api_clients');
const duration = 1814400000; // 3 weeks

router.get('/', async function(req, res, next) {
  const renderObj = {
    title: 'First Pass!',
  }
  res.render('index', renderObj);
});

router.get('/etix', async function(req, res, next) {
  const response = await etix(duration);
  const renderObj = {
    title: 'First Pass!',
  }
  res.json(response);
  //res.render('index', renderObj);
});

router.get('/eventbrite', async function(req, res, next) {
  const response = await eventbrite(duration);
  res.json(response);
});

router.get('/ticketmaster', async function(req, res, next) {
  const response = await ticketmaster(duration);
  res.json(response);
});

module.exports = router;
