const chai = require('chai');
const chaiHttp = require('chai-http');
const app = require('../src/server.js'); 
chai.use(chaiHttp);
const expect = chai.expect;
let server;

before(function(done) {
  server = app.listen(3001, done);
});

after(function(done) {
  if (server && server.listening) {
    server.close(done);
  } else {
    done();
  }
});

describe('Server Tests', () => {
  describe('GET /', () => {
    it('should return HTML file', (done) => {
      chai.request(server)
        .get('/')
        .end((err, res) => {
          expect(res).to.have.status(200);
          expect(res).to.be.html;
          done();
        });
    });
  });

  describe('GET /api', () => {
    it('should return Hello World message', (done) => {
      chai.request(server)
        .get('/api')
        .end((err, res) => {
          expect(res).to.have.status(200);
          expect(res.body).to.be.an('object');
          expect(res.body.message).to.equal('Hello World changes');
          done();
        });
    });
  });
});