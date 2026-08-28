#!/usr/bin/perl
# Minimal static file server for local preview. Node is not installed on this
# machine, so this exists purely so the dashboard can be opened in a browser
# with its JavaScript actually running. Not used in production.
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

my $server = IO::Socket::INET->new(
    LocalAddr => '127.0.0.1',
    LocalPort => $port,
    Proto     => 'tcp',
    Listen    => 16,
    ReuseAddr => 1,
) or die "cannot listen on $port: $!";

print STDERR "serving $root on http://127.0.0.1:$port/\n";

while (my $client = $server->accept()) {
    my $req = <$client>;
    unless (defined $req) { close $client; next; }

    # Drain the rest of the request headers.
    while (my $line = <$client>) { last if $line =~ /^\r?\n$/; }

    my ($method, $path) = $req =~ m{^(\w+)\s+(\S+)};
    $path = '/' unless defined $path;
    $path =~ s/\?.*$//;          # strip query string
    $path =~ s/\.\.//g;          # no traversal
    $path = '/index.html' if $path eq '/';

    my $file = $root . $path;
    if (-f $file) {
        my ($ext) = $file =~ /\.(\w+)$/;
        my $type = $TYPES{ lc($ext // '') } || 'application/octet-stream';
        open(my $fh, '<:raw', $file) or next;
        local $/;
        my $body = <$fh>;
        close $fh;
        print $client "HTTP/1.1 200 OK\r\n";
        print $client "Content-Type: $type\r\n";
        print $client "Content-Length: " . length($body) . "\r\n";
        print $client "Cache-Control: no-store\r\n";
        print $client "Connection: close\r\n\r\n";
        print $client $body;
    } else {
        my $body = "not found: $path";
        print $client "HTTP/1.1 404 Not Found\r\n";
        print $client "Content-Type: text/plain\r\n";
        print $client "Content-Length: " . length($body) . "\r\n";
        print $client "Connection: close\r\n\r\n";
        print $client $body;
    }
    close $client;
}
