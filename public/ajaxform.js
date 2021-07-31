$(document).ready(function () {
  $('eventform').submit(function (event) {
    event.preventDefault();
    const obj = $('eventform').serializeJSON();
    const jsonString = JSON.stringify(obj);
    $.ajax({
      type: "POST",
      url: "/events-json",
      data: jsonString,
      contentType: "application/json",
    }).done(function (data) {
      location.href = '/shows';
    });
  });
});
