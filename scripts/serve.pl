#!/usr/bin/perl
# LOCAL DEVELOPMENT HARNESS — never deployed.
#
# GitHub Pages serves the static files directly; this script exists only
# because the machine this was built on has no Node or Python, and the page
# needs a real HTTP origin for its JavaScript to run.
#
# It binds to 127.0.0.1 only and serves three things:
#   GET  /<path>            static files from the project directory
#   GET  /proxy?url=<url>   fetches a URL server-side, so the browser can run
#                           the production fetch modules without tripping CORS
#   POST /save?path=<path>  writes the request body to a file under data/,
#                           so a pipeline run in the browser can produce
#                           data/latest.json exactly as the Action would
#
# The proxy and save routes are development conveniences. Do not run this on a
# machine where something else can reach port 8787.
#
# Usage: perl scripts/serve.pl [port]

use strict;
use warnings;
use IO::Socket::INET;

my $port = $ARGV[0] || 8787;
my $root = '.';

my %TYPES = (
    html => 'text/html; charset=utf-8',
    css  => 'text/css; charset=utf-8',
    js   => 'application/javascript; charset=utf-8',
    mjs  => 'application/javascript; charset=utf-8',
    json => 'application/json; charset=utf-8',
    svg  => 'image/svg+xml',
    ico  => 'image/x-icon',
    txt  => 'text/plain; charset=utf-8',
);

sub url_decode {
    my $s = shift;
    $s =~ tr/+/ /;
    $s =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/ge;
    return $s;
}

sub send_response {
    my ($client, $status, $type, $body, $extra) = @_;
    print $client "HTTP/1.1 $status\r\n";
    print $client "Content-Type: $type\r\n";
    print $client "Content-Length: " . length($body) . "\r\n";
    print $client "Cache-Control: no-store\r\n";
    print $client "Access-Control-Allow-Origin: *\r\n";
    print $client $extra if $extra;
    print $client "Connection: close\r\n\r\n";
    print $client $body;
}

my $server = IO::Socket::INET->new(
    LocalAddr => '127.0.0.1',
    LocalPort => $port,
    Proto     => 'tcp',
    Listen    => 16,
    ReuseAddr => 1,
) or die "cannot listen on $port: $!";

print STDERR "serving $root on http://127.0.0.1:$port/ (static + /proxy + /save)\n";

while (my $client = $server->accept()) {
    my $req = <$client>;
    unless (defined $req) { close $client; next; }

    my ($method, $target) = $req =~ m{^(\w+)\s+(\S+)};
    $method ||= 'GET';
    $target ||= '/';

    # Read headers so we can find the body length.
    my $len = 0;
    while (my $line = <$client>) {
        last if $line =~ /^\r?\n$/;
        $len = $1 if $line =~ /^Content-Length:\s*(\d+)/i;
    }

    my ($path, $query) = split /\?/, $target, 2;
    $query = '' unless defined $query;
    $path =~ s/\.\.//g;

    # ---- proxy: fetch a URL server-side ----
    if ($path eq '/proxy') {
        my ($url) = $query =~ /(?:^|&)url=([^&]*)/;
        $url = url_decode($url // '');
        unless ($url =~ m{^https?://}) {
            send_response($client, '400 Bad Request', 'text/plain', 'bad url');
            close $client; next;
        }
        my $tmp = "proxy_tmp_$$.bin";
        my $ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
               . '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        system('curl', '-sL', '-m', '30', '--compressed',
               '-H', "User-Agent: $ua",
               '-H', 'Accept: */*',
               '-H', 'Accept-Language: en-GB,en;q=0.9',
               '-o', $tmp, $url);
        my $body = '';
        if (open(my $fh, '<:raw', $tmp)) { local $/; $body = <$fh> // ''; close $fh; }
        unlink $tmp;
        my $type = $url =~ /\.(?:xml|rss)(?:$|\?)/ ? 'application/xml; charset=utf-8'
                 : $body =~ /^\s*[\[{]/           ? 'application/json; charset=utf-8'
                 :                                  'text/plain; charset=utf-8';
        send_response($client, length($body) ? '200 OK' : '502 Bad Gateway', $type, $body);
        close $client; next;
    }

    # ---- save: write a pipeline result to disk ----
    if ($method eq 'POST' && $path eq '/save') {
        my ($dest) = $query =~ /(?:^|&)path=([^&]*)/;
        $dest = url_decode($dest // '');
        unless ($dest =~ m{^data/[\w./-]+$} && $dest !~ /\.\./) {
            send_response($client, '400 Bad Request', 'text/plain', 'bad path');
            close $client; next;
        }
        my $body = '';
        read($client, $body, $len) if $len;
        if (open(my $out, '>:raw', $dest)) {
            print $out $body;
            close $out;
            send_response($client, '200 OK', 'text/plain', "wrote $dest (" . length($body) . " bytes)");
        } else {
            send_response($client, '500 Internal Server Error', 'text/plain', "cannot write $dest: $!");
        }
        close $client; next;
    }

    # ---- static files ----
    $path = '/index.html' if $path eq '/';
    my $file = $root . $path;
    if (-f $file) {
        my ($ext) = $file =~ /\.(\w+)$/;
        my $type = $TYPES{ lc($ext // '') } || 'application/octet-stream';
        open(my $fh, '<:raw', $file) or next;
        local $/;
        my $body = <$fh>;
        close $fh;
        send_response($client, '200 OK', $type, $body);
    } else {
        send_response($client, '404 Not Found', 'text/plain', "not found: $path");
    }
    close $client;
}
