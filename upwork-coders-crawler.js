
var Crawler = require('crawler');
var util = require('util');
var Promise = require('node-promise').Promise;
var all = require('node-promise').all;
var fs = require('fs');

var logPath = './crawler.log';
if (fs.existsSync(logPath)) {
  fs.unlinkSync(logPath);
}
var fileDescriptor = fs.openSync(logPath, 'a');
var errorLog = function () {
  fs.writeSync(
    fileDescriptor,
    [].join.call(arguments, ' ') + '\n'
  );
};
var log = function () {
  console.log.apply(console, arguments);
};

var UpworkCodersCrawler = function (query) {
  this.BASE_URL = 'https://www.upwork.com';
  this.BASE_SEARCH_URL = this.BASE_URL + '/o/profiles/browse/';
  this.BASE_CODER_URL = this.BASE_URL + '/freelancers/';
  this.PROFILE_DATA_URL = this.BASE_URL + '/freelancers/api/v1/profile/';

  this.HEADERS = Object.freeze({
    'x-xsrf-token': 'c30494367484d4c724a3b70897f97c7f',
    'x-odesk-csrf-token': 'c30494367484d4c724a3b70897f97c7f',
    'cookie': 'session_id=a55d99407cf83e479f06bc6ee59567c5'
  });
  this.AJAX_HEADERS = JSON.parse(JSON.stringify(this.HEADERS));
  this.AJAX_HEADERS['x-requested-with'] = 'XMLHttpRequest';
  Object.freeze(this.AJAX_HEADERS);

  this.links = [];
  this.data = [];

  this.query = query;
};

UpworkCodersCrawler.prototype.collectLinksOnPage = function (pageNumber) {
  var collected = new Promise();
  var self = this;

  log('Start collect links on page', pageNumber);

  var callback = function (error, result, $) {
    $('.oProfileTileTitle a').each(function (i, item) {
      self.links.push(
        self.BASE_URL + $(item).attr('href')
      );
    });
  };

  var onDrain = function () {
    log('Finish collect links on page', pageNumber);
    collected.resolve(self.links);
  };

  var crawler = new Crawler({
    maxConnections: 100,
    callback: callback,
    onDrain: onDrain
  });

  var queryString = self.BASE_SEARCH_URL +
    '?q=' + self.query +
    '&page=' + pageNumber +
    '&pt=independent';

  crawler.queue({
    headers: self.HEADERS,
    uri: queryString
  });

  return collected;
};

UpworkCodersCrawler.prototype.collectLinks = function () {
  var collected = new Promise();
  var promises = [];
  var self = this;

  log('Start links collecting', self.query);

  // get max page number
  var crawler = new Crawler({
    maxConnections: 100,

    callback: function (error, result, $) {
      var lastPageButton = $('.pagination .active a');
      var lastPageNumber = +lastPageButton.html();
      // var lastPageNumber = 1;

      for (var i = 1; i <= lastPageNumber; i++) {
        try {
          promises.push(
            self.collectLinksOnPage(i)
          );
        } catch (e) {
          errorLog(
            'Failed to collect links on page ',
            i,
            ', for query',
            self.query
          );
        }
      }

      all(promises).then(function () {
        log('Finish links collecting', self.query);
        collected.resolve(self.links);
      });
    }
  });

  crawler.queue({
    uri: self.BASE_SEARCH_URL + '?q=' + self.query + '&page=1000',
    // uri: 'https://www.upwork.com/o/profiles/browse/?page=10000&q=react',
    headers: self.HEADERS
  });

  return collected;
};

UpworkCodersCrawler.prototype.parseProfile = function (url) {
  var parsed = new Promise();
  var self = this;

  log('Start parsing profile', url);

  var crawler = new Crawler({
    maxConnections: 100,

    callback: function (error, result, $) {
      var regexp = /\"userId\"\:\"(\d{18})/;
      var idRes = regexp.exec(result.body);

      if (!idRes || !idRes[1]) {
        errorLog(
          'No user id in the page',
          url,
          'for query',
          self.query
        );
        parsed.resolve();
        return;
      }

      var id = idRes[1];
      var dataUrl = self.PROFILE_DATA_URL + id;

      var dataCrawler = new Crawler({
        maxConnections: 100,

        callback: function (error, result) {
          try {
            result = JSON.parse(result.body);
          } catch (e) {
            errorLog(
              'Failed to parse json for',
              url,
              'for query',
              self.query
            );

            parsed.resolve();
            return;
          }

          if (result.assignments) {
            var jobs = result.assignments.filter(function (item) {
              return item.totalHours && item.hourlyRate;
            });

            if (result.assignments.length) {
              self.data.push({
                assignments: jobs
              });
            }
          }

          log('Finish parsing profile', url);
          parsed.resolve();
        }
      });

      dataCrawler.queue({
        uri: dataUrl,
        headers: self.HEADERS
      });
    }
  });

  crawler.queue({
    uri: url,
    headers: self.HEADERS
  });

  return parsed;
};

UpworkCodersCrawler.prototype.parseProfiles = function (urls) {
  var promises = [];
  var parsed = new Promise();
  var self = this;

  log('Start profiles parsing');
  log(urls);

  urls.forEach(function (url) {
    try {
      promises.push(
        self.parseProfile(url)
      );
    } catch (e) {
      errorLog(
        'Failed to parse profile',
        url
      );
    }
  });

  all(promises).then(function () {
    parsed.resolve();
    log('Finish prifiles parsing');
  });

  return parsed;
};

UpworkCodersCrawler.prototype.run = function () {
  var promise = new Promise();
  var self = this;

  self
    .collectLinks(this.query)
    .then(function (data) {
      var crawled = self.parseProfiles(data);

      crawled.then(function () {
        promise.resolve(self.data);
      });
    });

  return promise;
};

module.exports = UpworkCodersCrawler;
