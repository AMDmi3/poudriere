// vim: set sts=4 sw=4 ts=4 noet:
var updateInterval = 8;
var first_run = true;
var impulseData = new Array();
var tracker = 0;

/* Disabling jQuery caching */
$.ajaxSetup({
	cache: false
});

function catwidth (variable, queued) {
        if (variable == 0)
		return 0;
	var width = variable * 500 / queued;
	return (width < 1) ? 1 : Math.round (width);
}

function maxcatwidth(A, B, C, D, queued) {
	var cat = new Array();
	cat[0] = catwidth (A, queued);
	cat[1] = catwidth (B, queued);
	cat[2] = catwidth (C, queued);
	cat[3] = catwidth (D, queued);
	cat.sort();
	return (500 - cat[0] - cat[1] - cat[2]);
}

function minidraw(x, context, color, queued, variable, mcw) {
	var width = catwidth (variable, queued);
	if (width == 0)
		return (0);
	if (width > mcw)
		width = mcw;
	context.fillStyle = color;
	context.fillRect(x,  1, width, 20);
	return (width);
}


function update_fields() {
	$.ajax({
		url: '.data.json',
		dataType: 'json',
		success: function(data) {
			process_data(data);
		},
		error: function(data) {
			/* May not be there yet, try again shortly */
			setTimeout(update_fields, updateInterval * 500);
		}
	});
}

function format_origin(origin) {
	var data = origin.split("/");
	var port = (typeof data[1] == "undefined") ? "&nbsp;" : data[1];
	return "<a title=\"portsmon for " + origin +
		"\" href=\"http://portsmon.freebsd.org/portoverview.py?category=" +
		data[0] + "&amp;portname=" + port + "\">" + origin + "</a>";
}

function format_origin2(origin) {
	var data = origin.split("/");
	var port = (typeof data[1] == "undefined") ? "&nbsp;" : data[1];
	return "<a title=\"portsmon for " + origin +
		"\" href=\"http://portsmon.freebsd.org/portoverview.py?category=" +
		data[0] + "&amp;portname=" + port + "\">"+ port +
		"</a><br/>" + data[0];
}

function format_builder_status (status, buildtime) {
	var hack = buildtime == "" ? "&nbsp;" : buildtime.split("_").join(":");
	return status + '<br/><span class="timehack">' + hack + "</span>";
}

function format_pkgname(pkgname) {
	return pkgname;
}

function elapsed_seconds(stats_elapsed) {
	var HMS = stats_elapsed.split(":");
	return  (parseInt(HMS[0]) * 3600) + 
		(parseInt(HMS[1]) * 60) + parseInt(HMS[2]);
}

function display_pkghour(stats) {
	var attempted = parseInt(stats.built) + parseInt(stats.failed);
	var pkghour = "--";
	if (attempted > 0) {
		var hours = elapsed_seconds (stats.elapsed) / 3600;
		pkghour = Math.ceil(attempted / hours);
	}
	$('#stats_pkghour').html(pkghour);
}

function display_impulse(stats) {
	var attempted = parseInt(stats.built) + parseInt(stats.failed);
	var pkghour = "--";
	var secs = elapsed_seconds (stats.elapsed);
	var index = tracker % 75;
	if (tracker < 75) {
		impulseData.push({pkgs: attempted, time: secs});
	} else {
		impulseData[index].pkgs = attempted;
		impulseData[index].time = secs;
	}
	if (tracker >= 15) {
		var tail = (tracker < 75) ? 0 : (tracker - 74) % 75;
		var d_pkgs = impulseData[index].pkgs - impulseData[tail].pkgs;
		var d_secs = impulseData[index].time - impulseData[tail].time;
		pkghour = Math.ceil(d_pkgs / (d_secs / 3600));
	}
	tracker++;
	$('#stats_impulse').html(pkghour);
}

function update_canvas(stats) {
	var queued = stats.queued;
	var built = stats.built;
	var failed = stats.failed;
	var skipped = stats.skipped;
	var ignored = stats.ignored;
	var remaining = queued - built - failed - skipped - ignored;

	var canvas = document.getElementById('progressbar');
	if (canvas.getContext === undefined) {
		/* Not supported */
		return;
	}

	var context = canvas.getContext('2d');

	context.rect(0, 0, 500, 22);
	context.fillStyle = '#D8D8D8';
	context.fillRect(0, 1, 500, 20);
	var x = 0;
	var mcw = maxcatwidth (built, failed, ignored, skipped, queued);
	x += minidraw(x, context, "#339966", queued, built, mcw);
	x += minidraw(x, context, "#CC0033", queued, failed, mcw);
	x += minidraw(x, context, "#FFCC33", queued, ignored, mcw);
	x += minidraw(x, context, "#CC6633", queued, skipped, mcw);

	$('#stats_remaining').html(remaining);
}

function format_log(pkgname, errors, text) {
	var html;

	html = '<a href="logs/' + (errors ? 'errors/' : '') +
		pkgname + '.log">' + text + '</a>';
	return html;
}

function format_status_row(status, row) {
	var table_row = [];

	if (status == "built") {
		table_row.push(format_pkgname(row.pkgname));
		table_row.push(format_origin(row.origin));
		table_row.push(format_log(row.pkgname, false, "logfile"));
	} else if (status == "failed") {
		table_row.push(format_pkgname(row.pkgname));
		table_row.push(format_origin(row.origin));
		table_row.push(row.phase);
		table_row.push(row.skipped_cnt);
		table_row.push(format_log(row.pkgname, true, row.errortype));
	} else if (status == "skipped") {
		table_row.push(format_pkgname(row.pkgname));
		table_row.push(format_origin(row.origin));
		table_row.push(format_pkgname(row.depends));
	} else if (status == "ignored") {
		table_row.push(format_pkgname(row.pkgname));
		table_row.push(format_origin(row.origin));
		table_row.push(row.skipped_cnt);
		table_row.push(row.reason);
	}

	return table_row;
}

function format_setname(setname) {
	return setname ? ('-' + setname) : '';
}

function jump(myanchor) {
	$(document).scrollTop( $('#' + myanchor).offset().top );
}

function process_data(data) {
	var html, a, btime, master_status, n;
	var table_rows, table_row;

	// Redirect from /latest/ to the actual build.
	if (document.location.href.indexOf('/latest/') != -1) {
		document.location.href =
			document.location.href.replace('/latest/', '/' + 
			data.buildname + '/');
		return;
	}

	if (data.stats) {
		update_canvas(data.stats);
	}

	document.title = 'Poudriere bulk results for ' + data.mastername +
		data.buildname;

	$('#mastername').html(data.mastername);
	$('#buildname').html(data.buildname);
	if (data.svn_url)
		$('#svn_url').html(data.svn_url);
	else
		$('#svn_url').hide();

	/* Builder status */
	table_rows = [];
	for (n = 0; n < data.status.length; n++) {
		var builder = data.status[n];

		a = builder.status.split(":");
		if (builder.id != "main") {
			btime = (typeof a[2] == "undefined") ? "" : a[2];
			table_row = [];
			table_row.push(builder.id);
			table_row.push(format_origin2(a[1]));
			table_row.push(format_builder_status(a[0], btime));
			table_rows.push(table_row);
		}
		else {
			master_status = a[0];
			$('#builder_status').html(master_status);
		}
	}
	// XXX This could be improved by updating cells in-place
	$('#builders_table').dataTable().fnClearTable();
	$('#builders_table').dataTable().fnAddData(table_rows);

	/* Stats */
	if (data.stats) {
		$.each(data.stats, function(status, count) {
			html = count;
			$('#stats_' + status).html(html);
		});
		display_pkghour (data.stats);
		display_impulse (data.stats);
	}

	/* For each status, track how many of the existing data has been
	 * added to the table. On each update, only append new data. This
	 * is to lessen the amount of DOM redrawing on -a builds that
	 * may involve looping 24000 times. */

	if (data.ports) {
		$.each(data.ports, function(status, ports) {
			if (data.ports[status] && data.ports[status].length > 0) {
				table_rows = [];
				if ((n = $('#' + status + '_body').data('index')) === undefined) {
					n = 0;
					$('#' + status).show();
				}
				for (; n < data.ports[status].length; n++) {
					var row = data.ports[status][n];
					// Add in skipped counts for failures and ignores
					if (status == "failed" || status == "ignored")
						row.skipped_cnt =
							(data.skipped && data.skipped[row.pkgname]) ?
							data.skipped[row.pkgname] :
							0;

					table_rows.push(format_status_row(status, row));
				}
				$('#' + status + '_body').data('index', n);
				$('#' + status + '_table').dataTable().fnAddData(table_rows);
			}
		});
	}

	if (first_run == false) {
		$('.new').fadeIn(1500).removeClass('new');
	} else {
		// Hide loading overlay
		$('#loading_overlay').fadeOut(1400);
	}

	first_run = false;
	if (master_status == "stop") {
		// No further changes are coming, stop polling
		clearInterval(update_fields);
	} else {
		setTimeout(update_fields, updateInterval * 1000);
	}
}

$(document).ready(function() {
	var columnDefs, status, types, i;

	// Enable LOADING overlay until the page is loaded
	$('#loading_overlay').show();
	$('#builders_table').dataTable({
		"bFilter": false,
		"bInfo": false,
		"bPaginate": false,
		"aoColumnDefs": [{"bSortable": false, "aTargets": [0,1,2]}],
	});

	columnDefs = {
		"built": [
			// Disable sorting/searching on 'logfile' link
			{"bSortable": false, "aTargets": [2]},
			{"bSearchable": false, "aTargets": [2]},
		],
		"failed": [
			// Skipped count is numeric
			{"sType": "numeric", "aTargets": [3]},
		],
		"skipped": [],
		"ignored": [
			// Skipped count is numeric
			{"sType": "numeric", "aTargets": [2]},
		],
	};

	types = ['built', 'failed', 'skipped', 'ignored'];
	for (i in types) {
		status = types[i];
		$('#' + status).hide();
		$('#' + status + '_table').dataTable({
			"aaSorting": [], // No initial sorting
			"bProcessing": true, // Show processing icon
			"bDeferRender": true, // Defer creating TR/TD until needed
			"aoColumnDefs": columnDefs[status],
			"bStateSave": true, // Enable cookie for keeping state
			"aLengthMenu":[5,10,25,50,100],
		});
	}

	update_fields();
});

$(document).bind("keydown", function(e) {
	/* Disable F5 refreshing since this is AJAX driven. */
	if (e.which == 116) {
		e.preventDefault();
	}
});
