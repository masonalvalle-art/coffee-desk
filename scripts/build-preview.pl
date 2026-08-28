#!/usr/bin/perl
# Bundles index.html + assets/style.css + assets/app.js + data/latest.json into
# a single self-contained page, for publishing as a shareable preview.
# The real site loads these as separate files from GitHub Pages; this is only
# so the dashboard can be viewed before Pages is set up.
#
# Usage: perl scripts/build-preview.pl > preview.html

use strict;
use warnings;

# Source files are UTF-8 (accented origin names, degree signs, em dashes);
# without this the output is written as raw wide characters and mangles them.
binmode(STDOUT, ':encoding(UTF-8)');

sub slurp {
    my $f = shift;
    local $/;
    open(my $fh, '<:encoding(UTF-8)', $f) or die "cannot read $f: $!";
    my $d = <$fh>;
    close $fh;
    return $d;
}

my $html = slurp('index.html');
my $css  = slurp('assets/style.css');
my $js   = slurp('assets/app.js');
my $data = slurp('data/latest.json');
$data =~ s/\s+$//;

# The artifact host supplies its own doctype/html/head/body wrapper, so emit
# page content only.
my ($title)    = $html =~ /<title>(.*?)<\/title>/s;
my ($fontLink) = $html =~ /(<link href="https:\/\/fonts\.googleapis\.com[^>]*>)/s;
my ($body)     = $html =~ /<body>(.*)<\/body>/s;

# Drop the external script tag; the bundled script goes in explicitly.
$body =~ s/<script src="assets\/app\.js"><\/script>//s;

# Swap the network fetch for the inlined payload.
$js =~ s/  fetch\('data\/latest\.json[\s\S]*?\n    \}\);\n/  render(window.__COFFEE_DESK_DATA);\n/
  or die "could not find the fetch block to replace in app.js";

print "<title>$title</title>\n";
print "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n";
print "<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n";
print "$fontLink\n" if $fontLink;
print "<style>\n$css\n</style>\n";
print $body;
print "\n<script>window.__COFFEE_DESK_DATA = $data;</script>\n";
print "<script>\n$js\n</script>\n";
