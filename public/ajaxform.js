$(document).ready(function () {
  $('#eventform').submit(function (event) {
    event.preventDefault();
    const obj = $('#eventform').serializeJSON({useIntKeysAsArrayIndex: true});
    const jsonString = JSON.stringify(obj);
    $.ajax({
      type: "POST",
      url: "/events-json",
      data: jsonString,
      contentType: "application/json",
    }).done(function (data) {
      console.log("got response: " + data);
      console.log("redirecting!");
      window.location = '/shows';
    });
  });
});
