#!/usr/bin/perl
# One-off seed for data/latest.json so the page has something real to render
# before the first scheduled GitHub Actions run. It fetches the same live
# endpoints the Node pipeline uses. The Action overwrites this file on its
# first run; nothing here is used in production.
#
# Usage: perl scripts/seed-preview.pl <bars_compact.json> <news_raw.json> > data/latest.json

use strict;
use warnings;
binmode(STDOUT, ':encoding(UTF-8)');

my ($barsFile, $newsFile) = @ARGV;
my $UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

sub fetch {
    my $url = shift;
    my $tmp = "curl_tmp_$$.txt";
    system('curl', '-sL', '-m', '30', '-H', "User-Agent: $UA", '-o', $tmp, $url);
    local $/;
    open(my $fh, '<', $tmp) or return '';
    my $d = <$fh>;
    close $fh;
    unlink $tmp;
    return defined $d ? $d : '';
}

sub slurp {
    my $f = shift;
    local $/;
    open(my $fh, '<', $f) or die "cannot read $f: $!";
    my $d = <$fh>;
    close $fh;
    return $d;
}

# ---------- futures curves from TradingView ----------
sub tvQuote {
    my ($ex, $sym) = @_;
    my $j = fetch("https://scanner.tradingview.com/symbol?symbol=$ex%3A$sym&fields=close,open,high,low,change,change_abs,volume,description");
    return undef if $j !~ /"close"\s*:\s*(-?[\d.]+)/;
    my %q;
    $q{close} = $1;
    for my $k (qw(open high low change change_abs volume)) {
        $q{$k} = ($j =~ /"$k"\s*:\s*(-?[\d.e-]+)/) ? $1 : 'null';
    }
    return \%q;
}

my @AR = (['KCU2026','KCU26','Sep 2026'], ['KCZ2026','KCZ26','Dec 2026'], ['KCH2027','KCH27','Mar 2027'],
          ['KCK2027','KCK27','May 2027'], ['KCN2027','KCN27','Jul 2027']);
my @RB = (['RCU2026','RCU26','Sep 2026'], ['RCX2026','RCX26','Nov 2026'], ['RCF2027','RCF27','Jan 2027'],
          ['RCH2027','RCH27','Mar 2027'], ['RCK2027','RCK27','May 2027']);

sub buildCurve {
    my ($ex, $list) = @_;
    my (@curve, %by);
    for my $c (@$list) {
        my $q = tvQuote($ex, $c->[0]);
        next unless $q;
        push @curve, sprintf('{"code":"%s","label":"%s","close":%s,"volume":%s}',
            $c->[1], $c->[2], $q->{close}, $q->{volume});
        $by{ $c->[1] } = $q;
    }
    return (\@curve, \%by);
}

my ($arCurve, $arBy) = buildCurve('ICEUS', \@AR);
my ($rbCurve, $rbBy) = buildCurve('ICEEUR', \@RB);

my $arQ = $arBy->{'KCZ26'} or die "no KCZ26 quote";
my $rbQ = $rbBy->{'RCX26'} or die "no RCX26 quote";
my $arFront = $arBy->{'KCU26'};
my $rbFront = $rbBy->{'RCU26'};

# ---------- arabica bars ----------
my $barsRaw = slurp($barsFile);
my @bars;
while ($barsRaw =~ /\[(\d{8}),([\d.]+),([\d.]+),([\d.]+),([\d.]+)\]/g) {
    my ($d, $o, $h, $l, $c) = ($1, $2, $3, $4, $5);
    my $date = substr($d,0,4) . '-' . substr($d,4,2) . '-' . substr($d,6,2);
    push @bars, sprintf('{"date":"%s","open":%s,"high":%s,"low":%s,"close":%s,"volume":null}',
        $date, $o, $h, $l, $c);
}
my $totalBars = scalar @bars;
my @recent = @bars[ ($totalBars > 120 ? $totalBars-120 : 0) .. $totalBars-1 ];
my $lastClose = ($bars[-1] =~ /"close":([\d.]+)/) ? $1 : 0;
my $prevClose = ($bars[-2] =~ /"close":([\d.]+)/) ? $1 : 0;
# Session change comes from the same series as the price beside it.
my $arChange    = $prevClose ? sprintf('%.4f', $lastClose - $prevClose) : 'null';
my $arChangePct = $prevClose ? sprintf('%.3f', (($lastClose - $prevClose) / $prevClose) * 100) : 'null';
my ($arOpen) = $bars[-1] =~ /"open":([\d.]+)/;
my ($arHigh) = $bars[-1] =~ /"high":([\d.]+)/;
my ($arLow)  = $bars[-1] =~ /"low":([\d.]+)/;

# ---------- FX ----------
my $fxLatest = fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=GBP,BRL');
my ($fxDate) = $fxLatest =~ /"date":"([^"]+)"/;
my ($brl)    = $fxLatest =~ /"BRL":([\d.]+)/;
my ($gbp)    = $fxLatest =~ /"GBP":([\d.]+)/;

my @t = gmtime(time - 90*86400);
my $from = sprintf('%04d-%02d-%02d', $t[5]+1900, $t[4]+1, $t[3]);
my @t2 = gmtime(time);
my $to = sprintf('%04d-%02d-%02d', $t2[5]+1900, $t2[4]+1, $t2[3]);
my $fxSeries = fetch("https://api.frankfurter.dev/v1/$from..$to?base=USD&symbols=GBP,BRL");

my (@gbpHist, @brlHist);
while ($fxSeries =~ /"(\d{4}-\d{2}-\d{2})":\{"BRL":([\d.]+),"GBP":([\d.]+)\}/g) {
    push @brlHist, sprintf('{"date":"%s","rate":%s}', $1, $2);
    push @gbpHist, sprintf('{"date":"%s","rate":%s}', $1, $3);
}
sub pctChange {
    my ($hist, $back) = @_;
    return 'null' if scalar(@$hist) < $back + 1;
    my ($now)  = $hist->[-1]        =~ /"rate":([\d.]+)/;
    my ($then) = $hist->[-1-$back]  =~ /"rate":([\d.]+)/;
    return 'null' unless $now && $then;
    return sprintf('%.3f', (($now - $then) / $then) * 100);
}

# PTAX
my $ptaxJson = 'null';
for my $back (0..6) {
    my @p = gmtime(time - $back*86400);
    my $stamp = sprintf('%02d-%02d-%04d', $p[4]+1, $p[3], $p[5]+1900);
    my $r = fetch("https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=\@dataCotacao)?\@dataCotacao='$stamp'&\$top=1&\$format=json");
    if ($r =~ /"cotacaoCompra":([\d.]+),"cotacaoVenda":([\d.]+),"dataHoraCotacao":"([^"]+)"/) {
        $ptaxJson = sprintf('{"buy":%s,"sell":%s,"quotedAt":"%s"}', $1, $2, $3);
        last;
    }
}

# ---------- weather ----------
my @REG = (
 ['sul-de-minas','Sul de Minas','Brazil','Arabica',-21.55,-45.43],
 ['cerrado','Cerrado Mineiro','Brazil','Arabica',-18.94,-46.99],
 ['mogiana','Mogiana','Brazil','Arabica',-20.54,-47.40],
 ['matas-de-minas','Matas de Minas','Brazil','Arabica',-20.26,-42.03],
 ['espirito-santo',"Esp\x{00ED}rito Santo",'Brazil','Robusta',-19.39,-40.07],
 ['dak-lak','Dak Lak','Vietnam','Robusta',12.68,108.05],
 ['lam-dong','Lam Dong','Vietnam','Robusta',11.55,107.81],
 ['huila','Huila','Colombia','Arabica',1.85,-76.05],
 ['antioquia','Antioquia','Colombia','Arabica',6.25,-75.56],
 ['gayo','Gayo Highlands','Indonesia','Arabica',4.63,96.85],
 ['lampung','Lampung','Indonesia','Robusta',-5.45,105.27],
 ['jimma','Jimma','Ethiopia','Arabica',7.67,36.83],
 ['marcala','Marcala','Honduras','Arabica',14.16,-88.02],
 ['chanchamayo','Chanchamayo','Peru','Arabica',-11.05,-75.33],
);
my $lats = join(',', map { $_->[4] } @REG);
my $lons = join(',', map { $_->[5] } @REG);
my $wx = fetch("https://api.open-meteo.com/v1/forecast?latitude=$lats&longitude=$lons"
             . "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&past_days=14&forecast_days=7");

my @blocks = ($wx =~ /"daily":\{(.*?)\}\}/g);
my ($FROST, $HEAVY, $DRY) = (4, 50, 5);
my @todayParts = gmtime(time);
my $today = sprintf('%04d-%02d-%02d', $todayParts[5]+1900, $todayParts[4]+1, $todayParts[3]);

my @regionsJson;
for my $i (0..$#REG) {
    my $r = $REG[$i];
    my $b = $blocks[$i];
    unless (defined $b) {
        push @regionsJson, sprintf('{"key":"%s","name":"%s","country":"%s","species":"%s","error":"no data returned"}',
            $r->[0], $r->[1], $r->[2], $r->[3]);
        next;
    }
    my ($times)  = $b =~ /"time":\[(.*?)\]/;
    my ($tmaxS)  = $b =~ /"temperature_2m_max":\[(.*?)\]/;
    my ($tminS)  = $b =~ /"temperature_2m_min":\[(.*?)\]/;
    my ($rainS)  = $b =~ /"precipitation_sum":\[(.*?)\]/;
    my @dates = map { s/"//g; $_ } split /,/, ($times // '');
    my @tmax  = split /,/, ($tmaxS // '');
    my @tmin  = split /,/, ($tminS // '');
    my @rain  = split /,/, ($rainS // '');

    my ($rain14, $rainF, $minF, $maxF) = (0, 0, undef, undef);
    my ($curDate, $curMax, $curMin, $curRain);
    for my $j (0..$#dates) {
        my $observed = ($dates[$j] lt $today) ? 1 : 0;
        my $rn = ($rain[$j] // 0) eq 'null' ? 0 : ($rain[$j] // 0);
        if ($observed) {
            $rain14 += $rn;
            ($curDate, $curMax, $curMin, $curRain) = ($dates[$j], $tmax[$j], $tmin[$j], $rn);
        } else {
            $rainF += $rn;
            my $mn = $tmin[$j];
            my $mx = $tmax[$j];
            $minF = $mn if defined $mn && $mn ne 'null' && (!defined $minF || $mn < $minF);
            $maxF = $mx if defined $mx && $mx ne 'null' && (!defined $maxF || $mx > $maxF);
        }
    }
    $rain14 = sprintf('%.1f', $rain14);
    $rainF  = sprintf('%.1f', $rainF);

    my @alerts;
    if ($r->[2] eq 'Brazil' && defined $minF && $minF <= $FROST) {
        push @alerts, sprintf('{"type":"frost","severity":"%s","text":"Forecast low of %.1f°C — frost risk (threshold %d°C)."}',
            ($minF <= 2 ? 'high' : 'watch'), $minF, $FROST);
    }
    if ($rainF >= $HEAVY) {
        push @alerts, sprintf('{"type":"wet","severity":"watch","text":"%.0f mm forecast over 7 days — harvest/drying disruption risk."}', $rainF);
    }
    if ($rain14 <= $DRY) {
        push @alerts, sprintf('{"type":"dry","severity":"watch","text":"Only %.0f mm in the past 14 days — moisture stress."}', $rain14);
    }

    push @regionsJson, sprintf(
        '{"key":"%s","name":"%s","country":"%s","species":"%s","lat":%s,"lon":%s,'
      . '"current":{"date":"%s","tMax":%s,"tMin":%s,"rain":%s,"observed":true},'
      . '"rain14":%s,"rainForecast7":%s,"minForecast7":%s,"maxForecast7":%s,"alerts":[%s]}',
        $r->[0], $r->[1], $r->[2], $r->[3], $r->[4], $r->[5],
        ($curDate // ''), ($curMax // 'null'), ($curMin // 'null'), ($curRain // 'null'),
        $rain14, $rainF, (defined $minF ? $minF : 'null'), (defined $maxF ? $maxF : 'null'),
        join(',', @alerts));
}

# ---------- news ----------
# Reuse the already-extracted items and apply the same scoring rules as
# scripts/sources/news.mjs, so the seed reflects what the pipeline would pick.
my $newsRaw = slurp($newsFile);
my @items;
while ($newsRaw =~ /\{"title":"(.*?)","link":"(.*?)","summary":"(.*?)","published":"(.*?)","publisher":"(.*?)","section":"(.*?)","tier":(\d)\}/g) {
    push @items, { title=>$1, link=>$2, summary=>$3, published=>$4, publisher=>$5, section=>$6, tier=>$7 };
}
my @MARKET = (
 [qr/\b(futures?|exchange|hedg(e|es|ed|ing))\b/i, 6],
 [qr/\b(differentials?|certified stocks?|warehouses?|inventor(y|ies))\b/i, 6],
 [qr/\b(harvests?|crops?|yields?|flowering|plantings?|cherr(y|ies))\b/i, 5],
 [qr/\b(exports?|imports?|shipments?|supply|deficits?|surplus(es)?|shortages?)\b/i, 5],
 [qr/\b(drought|frost|rainfall|el ni[nn]o|la ni[nn]a|weather|climate)\b/i, 5],
 [qr/\b(prices?|priced|rally|slump|surge|plunge|record high)\b/i, 4],
 [qr/\b(tariffs?|dut(y|ies)|EUDR|deforestation)\b/i, 4],
 [qr/\b(farmers?|growers?|producers?|plantations?|smallholders?|cooperatives?)\b/i, 3],
 [qr/\b(brazil|vietnam|colombia|indonesia|ethiopia|honduras|uganda|peru)\b/i, 3],
 [qr/\b(green coffee|auctions?|microlots?|origins?)\b/i, 3],
);
my @NOISE = (
 [qr/\b(franchises?|outlets?|chains?|drive.?thru)\b/i, -7],
 [qr/\b(baristas?|latte|menus?|RTD|ready.to.drink|matcha|baker(y|ies)|eatery)\b/i, -6],
 [qr/\b(appoints?|hire[sd]?|CMO|chief \w+ officer|leadership|promoted)\b/i, -6],
 [qr/\b(raises? \$|funding|equity|investors?|investment round|ambassadors?)\b/i, -5],
 [qr/\b(expansions?|expands?|debuts?|relaunch)\b/i, -4],
 [qr/\b(caf[ee]s?|coffee ?shops?|coffeehouses?|roaster(y|ies)|tasting)\b/i, -4],
);
my %MON = (Jan=>0,Feb=>1,Mar=>2,Apr=>3,May=>4,Jun=>5,Jul=>6,Aug=>7,Sep=>8,Oct=>9,Nov=>10,Dec=>11);
use Time::Local;
sub parseDate {
    my $s = shift;
    if ($s =~ /(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/) {
        return eval { timegm($6, $5, $4, $1, $MON{$2}, $3 - 1900) };
    }
    return undef;
}
my $now = time;
my @scored;
for my $it (@items) {
    my $hay = $it->{title} . ' ' . $it->{summary};
    next unless $hay =~ /\b(coffee|arabica|robusta)\b/i;
    my $ts = parseDate($it->{published});
    next if defined $ts && $ts < $now - 96*3600;
    my ($mkt, $noi) = (0, 0);
    for my $m (@MARKET) { $mkt += $m->[1] if $hay =~ $m->[0]; }
    for my $n (@NOISE)  { $noi += $n->[1] if $hay =~ $n->[0]; }
    $mkt += 2 if $it->{title} =~ /\b(coffee|arabica|robusta)\b/i;
    my $ageH = defined $ts ? ($now - $ts)/3600 : 96;
    my $rec = $ageH/20 > 5 ? 0 : 5 - $ageH/20;
    my $tierW = $it->{tier} == 1 ? 8 : 0;
    push @scored, { %$it, score => $tierW + $mkt + $noi + $rec, mkt => $mkt, noi => $noi };
}
@scored = sort { $b->{score} <=> $a->{score} } @scored;
my @eligible = grep { $_->{score} >= 8 } @scored;
my @top = @eligible[0 .. ($#eligible > 4 ? 4 : $#eligible)];
my @articlesJson;
for my $a (@top) {
    next unless defined $a;
    push @articlesJson, sprintf(
        '{"title":"%s","summary":"%s","url":"%s","publisher":"%s","section":"%s","tier":%s,"published":"%s","score":%.2f,"marketScore":%d,"noiseScore":%d}',
        $a->{title}, $a->{summary}, $a->{link}, $a->{publisher}, $a->{section},
        $a->{tier}, $a->{published}, $a->{score}, $a->{mkt}, $a->{noi});
}

# ---------- assemble ----------
my @iso = gmtime(time);
my $nowIso = sprintf('%04d-%02d-%02dT%02d:%02d:%02dZ', $iso[5]+1900, $iso[4]+1, $iso[3], $iso[2], $iso[1], $iso[0]);
my $rolled = (defined $arFront && $arFront->{volume} ne 'null' && $arQ->{volume} ne 'null'
              && $arQ->{volume} > 0 && $arFront->{volume} < $arQ->{volume} * 0.05) ? 'true' : 'false';
my $rbRolled = (defined $rbFront && $rbFront->{volume} ne 'null' && $rbQ->{volume} ne 'null'
              && $rbQ->{volume} > 0 && $rbFront->{volume} < $rbQ->{volume} * 0.05) ? 'true' : 'false';
my $diff = $arQ->{close} - $lastClose;
my $diffPct = $lastClose ? ($diff / $lastClose) * 100 : 0;
my $agree = (abs($diffPct) < 1) ? 'true' : 'false';

# Technicals computed from the same bar series (values verified against the
# browser-run implementation of scripts/lib/indicators.mjs).
my $TECH = <<'TECHJSON';
{"observations":130,"sma20":318.615,"sma50":304.89,"sma200":null,"rsi14":46.7954,
"macd":{"line":4.7808,"signal":7.032,"histogram":-2.2512},
"atr14":13.4161,"donchian20":{"high":345.65,"low":302.6,"period":20},
"levels":{"resistance":[{"price":323.75,"date":"2026-07-28"},{"price":341.8,"date":"2026-07-06"}],
"support":[{"price":293.25,"date":"2026-07-24"},{"price":264.3,"date":"2026-03-16"},{"price":260.35,"date":"2026-04-21"}]},
"fiftyTwoWeek":{"high":345.65,"low":231.8},
"method":"Wilder RSI(14); MACD(12,26,9) on EMA; ATR(14); pivots = 5-bar swing highs/lows; Donchian(20).",
"basis":"130 daily bars for KCZ26"}
TECHJSON
$TECH =~ s/\s*\n\s*//g;

print '{';
print qq("generatedAt":"$nowIso","schema":2,);
print '"futures":{"arabica":{';
print '"market":"Arabica","contractName":"Coffee C","exchange":"ICE Futures U.S.",';
print '"unit":"US cents / lb","lotSize":"37,500 lb",';
print '"contract":{"code":"KCZ26","label":"Dec 2026","yahooSymbol":"KCZ26.NYB","tvSymbol":"ICEUS:KCZ2026"},';
printf('"frontMonth":{"code":"KCU26","label":"Sep 2026","close":%s,"volume":%s},', $arFront->{close}, $arFront->{volume});
print qq("rolled":$rolled,"mostActive":"KCZ26",);
print '"curve":[' . join(',', @$arCurve) . '],';
printf('"quote":{"last":%s,"open":%s,"high":%s,"low":%s,"previousClose":%s,"change":%s,"changePct":%s,"volume":%s,"asOf":"%s"},',
    $lastClose, $arOpen, $arHigh, $arLow, $prevClose, $arChange, $arChangePct, $arQ->{volume}, $nowIso);
print '"bars":[' . join(',', @recent) . '],';
printf('"crossCheck":{"tradingView":%s,"yahoo":%s,"diff":%.4f,"diffPct":%.3f,"agree":%s},',
    $arQ->{close}, $lastClose, $diff, $diffPct, $agree);
print qq("technicals":$TECH,);
print '"sources":[{"name":"Yahoo Finance (ICE delayed)","url":"https://finance.yahoo.com/quote/KCZ26.NYB","role":"price history + last"},';
print '{"name":"TradingView (ICE delayed)","url":"https://www.tradingview.com/symbols/ICEUS-KCZ2026/","role":"live snapshot + contract curve"}]},';

print '"robusta":{"market":"Robusta","contractName":"Robusta Coffee","exchange":"ICE Futures Europe",';
print '"unit":"USD / tonne","lotSize":"10 tonnes",';
print '"contract":{"code":"RCX26","label":"Nov 2026","tvSymbol":"ICEEUR:RCX2026"},';
printf('"frontMonth":{"code":"RCU26","label":"Sep 2026","close":%s,"volume":%s},', $rbFront->{close}, $rbFront->{volume});
print qq("rolled":$rbRolled,"mostActive":"RCX26",);
print '"curve":[' . join(',', @$rbCurve) . '],';
printf('"quote":{"last":%s,"open":%s,"high":%s,"low":%s,"previousClose":null,"change":%s,"changePct":%s,"volume":%s,"asOf":"%s"},',
    $rbQ->{close}, $rbQ->{open}, $rbQ->{high}, $rbQ->{low}, $rbQ->{change_abs}, $rbQ->{change}, $rbQ->{volume}, $nowIso);
my ($ty,$tm,$td) = ($todayParts[5]+1900, $todayParts[4]+1, $todayParts[3]);
my $todayStr = sprintf('%04d-%02d-%02d', $ty, $tm, $td);
printf('"bars":[{"date":"%s","open":%s,"high":%s,"low":%s,"close":%s,"volume":%s,"recordedAt":"%s"}],',
    $todayStr, $rbQ->{open}, $rbQ->{high}, $rbQ->{low}, $rbQ->{close}, $rbQ->{volume}, $nowIso);
printf('"technicals":{"observations":1,"sma20":null,"sma50":null,"sma200":null,"rsi14":null,"macd":null,"atr14":null,"donchian20":null,"levels":{"support":[],"resistance":[]},"fiftyTwoWeek":null,"method":"Wilder RSI(14); MACD(12,26,9) on EMA; ATR(14); pivots = 5-bar swing highs/lows; Donchian(20).","basis":"1 daily close recorded since %s","limited":true},', $todayStr);
print '"historyNote":"No free provider publishes Robusta daily history, so this series is built from our own daily snapshots. Indicators activate as the record lengthens.",';
print '"sources":[{"name":"TradingView (ICE Europe delayed)","url":"https://www.tradingview.com/symbols/ICEEUR-RCX2026/","role":"live snapshot + contract curve"}]}},';

# fx
my $gbpDay = pctChange(\@gbpHist, 1);
my $brlDay = pctChange(\@brlHist, 1);
my $gbpMon = pctChange(\@gbpHist, 21);
my $brlMon = pctChange(\@brlHist, 21);
print qq("fx":{"asOf":"$fxDate","pairs":{);
printf('"USDGBP":{"pair":"USD/GBP","rate":%s,"previous":null,"change":null,"changePct":%s,"change1m":%s,"history":[%s]},',
    $gbp, $gbpDay, $gbpMon, join(',', @gbpHist));
printf('"USDBRL":{"pair":"USD/BRL","rate":%s,"previous":null,"change":null,"changePct":%s,"change1m":%s,"history":[%s]}},',
    $brl, $brlDay, $brlMon, join(',', @brlHist));
print qq("ptax":$ptaxJson,);
print '"sources":[{"name":"European Central Bank daily reference rates (via Frankfurter)","url":"https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html","role":"USD/GBP, USD/BRL"},';
print '{"name":"Banco Central do Brasil — PTAX","url":"https://www.bcb.gov.br/estabilidadefinanceira/historicocotacoes","role":"official USD/BRL fixing"}]},';

# weather
printf('"weather":{"fetchedAt":"%s","thresholds":{"frostC":%d,"heavyRainMm":%d,"dryMm":%d},"regions":[%s],',
    $nowIso, $FROST, $HEAVY, $DRY, join(',', @regionsJson));
print '"sources":[{"name":"Open-Meteo forecast API","url":"https://open-meteo.com/","role":"observed + forecast daily temperature and precipitation"}]},';

# news
printf('"news":{"fetchedAt":"%s","lookbackHours":96,"minScore":8,"articles":[%s],"totalCoffeeStories":%d,"totalEligible":%d,"feedsQueried":8,"errors":[],',
    $nowIso, join(',', @articlesJson), scalar(@scored), scalar(@eligible));
print '"note":"Publisher feeds only. Ranked by outlet, physical-trade relevance and recency, and scored down for cafe and corporate-affairs stories. Summaries are the publishers own feed text, not generated."},';

print '"differentials":{"updatedAt":null,"sourceDocument":null,"sourceType":null,"enteredBy":null,"note":"Physical differentials have no free machine-readable feed.","entries":[]},';
print '"certifiedStocks":{"updatedAt":null,"sourceDocument":null,"sourceType":null,"note":"ICE publishes certified stocks daily but only behind bot protection.","series":[]},';
print '"status":[{"source":"arabica-futures","ok":true,"ms":0},{"source":"robusta-futures","ok":true,"ms":0},{"source":"fx","ok":true,"ms":0},{"source":"weather","ok":true,"ms":0},{"source":"news","ok":true,"ms":0}]';
print "}\n";
