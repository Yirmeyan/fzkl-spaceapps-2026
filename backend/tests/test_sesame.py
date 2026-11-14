import asyncio

import httpx2
import pytest

from spherex_explorer.errors import NotFound, UpstreamError, UpstreamUnavailable
from spherex_explorer.targets import InvalidName, SesameResolver, clean_name, parse_sesame

MAIN = "https://resolver.example/cgi-bin/nph-sesame"
MIRROR = "https://mirror.example/viz-bin/nph-sesame"

BARNARD = b"""<?xml version="1.0" encoding="UTF-8"?>
<Sesame xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<Target option="SNV">
  <name>Barnard's Star</name>
  <Resolver name="S=Simbad (CDS, via client/server)">
    <INFO>from cache</INFO>
    <oname>NAME Barnard's star</oname>
    <otype>BY*</otype>
    <jpos>17:57:48.49 +04:41:36.1</jpos>
    <jradeg>269.4520769586187</jradeg>
    <jdedeg>4.69336496657667</jdedeg>
    <pm>
      <v>10393.349</v><e>0.048</e><q>A</q>
      <pa>355.577</pa>
      <pmRA>-801.551</pmRA><epmRA>0.032</epmRA>
      <pmDE>10362.394</pmDE><epmDE>0.036</epmDE>
    </pm>
    <plx><v>546.9759</v><e>0.0401</e></plx>
  </Resolver>
</Target>
</Sesame>
"""
NOTHING = b"""<?xml version="1.0" encoding="UTF-8"?>
<Sesame><Target option="SNV"><name>zzqq</name>
  <INFO> *** Nothing found *** </INFO>
</Target></Sesame>
"""
GALAXY = b"""<?xml version="1.0"?>
<Sesame><Target option="SNV"><name>M31</name>
  <Resolver name="S=Simbad"><oname>M  31</oname>
    <jradeg>10.684708</jradeg><jdedeg>41.268750</jdedeg>
  </Resolver>
</Target></Sesame>
"""


def test_star_of_simbad_gives_its_position_in_2000_and_its_motion():
    target = parse_sesame(BARNARD, "Barnard's Star")

    assert target.name == "Barnard's Star"
    assert (target.ra, target.dec) == pytest.approx((269.452077, 4.693365), abs=1e-6)
    assert target.epoch == 2000.0
    assert (target.pm_ra, target.pm_dec) == (-801.551, 10362.394)


def test_object_without_proper_motion_has_none():
    target = parse_sesame(GALAXY, "M31")

    assert (target.ra, target.dec) == (10.684708, 41.26875)
    assert (target.pm_ra, target.pm_dec) == (None, None)


def test_name_no_catalog_knows_gives_nothing():
    assert parse_sesame(NOTHING, "zzqq") is None


def test_resolver_without_a_usable_position_is_skipped_for_the_next_one():
    payload = GALAXY.replace(
        b'<Resolver name="S=Simbad">',
        b'<Resolver name="N=NED"><jradeg>not a number</jradeg><jdedeg>1</jdedeg></Resolver>'
        b'<Resolver name="S=Simbad">',
    )

    assert parse_sesame(payload, "M31").ra == 10.684708


@pytest.mark.parametrize(
    "payload",
    [
        b"<html>Service down</html>",
        b"<Sesame><Target>",
        b'<!DOCTYPE Sesame [<!ENTITY a "aaaa">]><Sesame/>',
    ],
)
def test_answer_of_another_shape_is_an_error(payload):
    with pytest.raises(UpstreamError):
        parse_sesame(payload, "anything")


def test_names_are_trimmed_and_their_spaces_collapsed():
    assert clean_name("  Barnard's   Star \t") == "Barnard's Star"


@pytest.mark.parametrize("name", ["", "   ", "x" * 101, "bell\x07", "new\nline\x00"])
def test_what_cannot_be_a_name_is_refused(name):
    with pytest.raises(InvalidName):
        clean_name(name)


class Sites:
    """Stands for the resolver and its mirror: answers queued for each host."""

    def __init__(self, **answers):
        self.answers = {host: list(queue) for host, queue in answers.items()}
        self.requests: list[httpx2.Request] = []

    def handle(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        answer = self.answers[request.url.host.split(".")[0]].pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


def resolve(sites: Sites, *names: str, urls=(MAIN, MIRROR)):
    async def run():
        async with httpx2.AsyncClient(transport=httpx2.MockTransport(sites.handle)) as client:
            resolver = SesameResolver(client, urls=urls, timeout_s=5.0)
            return [await resolver.resolve(name) for name in names]

    return asyncio.run(run())


def found(payload: bytes = BARNARD) -> httpx2.Response:
    return httpx2.Response(200, content=payload)


def test_name_is_sent_encoded_with_the_xml_option():
    sites = Sites(resolver=[found()])

    [target] = resolve(sites, "Barnard's  Star")

    assert target.pm_dec == 10362.394
    assert str(sites.requests[0].url) == f"{MAIN}/-ox/SNV?Barnard%27s%20Star"


def test_redirection_to_a_mirror_is_followed():
    moved = httpx2.Response(302, headers={"Location": f"{MIRROR}/-ox/SNV?Barnard%27s%20Star"})
    sites = Sites(resolver=[moved], mirror=[found()])

    [target] = resolve(sites, "Barnard's Star")

    assert target.ra == pytest.approx(269.452077, abs=1e-6)
    assert [request.url.host for request in sites.requests] == [
        "resolver.example",
        "mirror.example",
    ]


@pytest.mark.parametrize(
    "failure",
    [
        httpx2.Response(503),
        httpx2.ReadTimeout("too slow"),
        httpx2.RemoteProtocolError("Server disconnected without sending a response."),
    ],
)
def test_second_address_is_asked_when_the_first_one_fails(failure):
    sites = Sites(resolver=[failure], mirror=[found()])

    [target] = resolve(sites, "Barnard's Star")

    assert target.name == "Barnard's Star"
    assert len(sites.requests) == 2


def test_every_address_failing_is_reported_as_unavailable():
    sites = Sites(resolver=[httpx2.Response(500)], mirror=[httpx2.ConnectError("no route")])

    with pytest.raises(UpstreamUnavailable) as error:
        resolve(sites, "Barnard's Star")

    assert error.value.retry_after_s == 10


def test_unknown_name_is_not_found_with_a_sentence_for_the_client():
    sites = Sites(resolver=[found(NOTHING)])

    with pytest.raises(NotFound) as error:
        resolve(sites, "zzqq")

    assert error.value.public == "No object is known under this name."
    assert len(sites.requests) == 1


def test_name_already_resolved_is_answered_from_memory_whatever_its_case():
    sites = Sites(resolver=[found()])

    first, second = resolve(sites, "Barnard's Star", "  barnard's   STAR ")

    assert first.ra == second.ra
    assert second.name == "Barnard's Star"
    assert len(sites.requests) == 1


def test_unknown_name_is_asked_again_the_next_time():
    sites = Sites(resolver=[found(NOTHING), found()])

    with pytest.raises(NotFound):
        resolve(sites, "Barnard's Star")
    [target] = resolve(sites, "Barnard's Star")

    assert target.pm_ra == -801.551
