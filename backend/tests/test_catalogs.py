"""Catalogs of other telescopes: the answers of VizieR, and the service that asks for them."""

import asyncio

import httpx2
import pytest

from spherex_explorer.catalogs import ALLWISE, GAIA, VizierCatalogs, parse_vizier
from spherex_explorer.errors import UpstreamError, UpstreamUnavailable
from vizier_answers import (
    ALLWISE_ANSWER,
    BARNARD_LINE,
    EMPTY_ANSWER,
    FAINT_LINE,
    GAIA_ANSWER,
    NEIGHBOR_LINE,
    REFUSED_ANSWER,
    gaia_answer,
)

MAIN = "https://catalogs.example"
MIRROR = "https://mirror.example"


def test_a_line_of_gaia_gives_a_place_a_motion_and_a_brightness():
    barnard, neighbor, _ = parse_vizier(GAIA_ANSWER, GAIA)

    assert barnard.id == "Gaia DR3 4472832130942575872"
    assert (barnard.ra, barnard.dec) == (269.44850252544, 4.73942005111)
    assert (barnard.pm_ra, barnard.pm_dec) == (-801.551, 10362.394)
    assert (barnard.parallax, barnard.parallax_error) == (546.9759, 0.0401)
    assert barnard.magnitudes == (("G", 8.193974),)
    assert neighbor.pm_dec == -8.671


def test_what_a_catalog_does_not_give_is_none():
    faint = parse_vizier(GAIA_ANSWER, GAIA)[2]

    assert (faint.pm_ra, faint.pm_dec, faint.parallax, faint.parallax_error) == (None,) * 4
    assert faint.magnitudes == (("G", 20.989813),)


def test_allwise_gives_two_bands_and_no_motion():
    bright, other = parse_vizier(ALLWISE_ANSWER, ALLWISE)

    assert bright.id == "J175747.94+044323.8"
    assert (bright.ra, bright.dec) == (269.44977, 4.72328)
    assert bright.magnitudes == (("W2", 3.658), ("W1", 4.358))
    assert (bright.pm_ra, bright.pm_dec, bright.parallax) == (None, None, None)
    assert other.magnitudes == (("W2", 9.435),)
    assert ALLWISE.band == "W2"
    assert ALLWISE.epoch == pytest.approx(2010.56)


def test_an_empty_cone_is_an_empty_list():
    assert parse_vizier(EMPTY_ANSWER, GAIA) == []


def test_a_line_without_a_place_is_left_out():
    nowhere = "Gaia DR3 1\t               \t+04.70000000000\t\t\t\t\t12.0\n"
    off_the_sky = "Gaia DR3 2\t269.40000000000\t+94.70000000000\t\t\t\t\t12.0\n"

    sources = parse_vizier(gaia_answer(nowhere, off_the_sky, NEIGHBOR_LINE), GAIA)

    assert [source.id for source in sources] == ["Gaia DR3 4472832165289153024"]


@pytest.mark.parametrize(
    "payload",
    [
        REFUSED_ANSWER,
        "<html>Service down</html>",
        ALLWISE_ANSWER,
        GAIA_ANSWER.replace("pmRA\tpmDE", "pmDE\tpmRA"),
        gaia_answer("Gaia DR3 3\t269.4\t+04.7\t12.0\n"),
        GAIA_ANSWER.replace("----", "===="),
    ],
)
def test_an_answer_of_another_shape_is_an_error(payload):
    with pytest.raises(UpstreamError):
        parse_vizier(payload, GAIA)


class Sites:
    """Stands for VizieR and its mirror: answers queued for each host."""

    def __init__(self, **answers):
        self.answers = {host: list(queue) for host, queue in answers.items()}
        self.requests: list[httpx2.Request] = []

    def handle(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        answer = self.answers[request.url.host.split(".")[0]].pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


def found(payload: str = GAIA_ANSWER) -> httpx2.Response:
    return httpx2.Response(200, text=payload)


def ask(sites: Sites, *cones, urls=(MAIN, MIRROR), **options):
    """Cones asked one after the other to the same service: (catalog, ra, dec, radius)."""

    async def run():
        async with httpx2.AsyncClient(transport=httpx2.MockTransport(sites.handle)) as client:
            service = VizierCatalogs(client, urls=urls, timeout_s=5.0, pause_s=0.0, **options)
            return [await service.around(*cone) for cone in cones]

    return asyncio.run(run())


def test_a_cone_is_asked_sorted_with_one_source_more_than_kept():
    sites = Sites(catalogs=[found()])

    [cone] = ask(sites, (GAIA, 269.45203, 4.69298, 0.1), limit=300)

    request = sites.requests[0]
    assert str(request.url).startswith(f"{MAIN}/viz-bin/asu-tsv?")
    assert dict(request.url.params) == {
        "-source": "I/355/gaiadr3",
        "-c": "269.4520 +4.6930",
        "-c.rd": "0.1000",
        "-out": "DR3Name,RA_ICRS,DE_ICRS,pmRA,pmDE,Plx,e_Plx,Gmag",
        "-sort": "Gmag",
        "-out.max": "301",
    }
    assert len(cone.sources) == 3
    assert cone.complete


def test_more_sources_than_asked_for_means_the_faintest_are_missing():
    sites = Sites(catalogs=[found()])

    [cone] = ask(sites, (GAIA, 269.452, 4.693, 0.1), limit=2)

    assert [source.id[-4:] for source in cone.sources] == ["5872", "3024"]
    assert not cone.complete


def test_the_same_cone_is_asked_once_a_day():
    hours = iter([0.0, 1.0, 25.0, 25.0])
    sites = Sites(catalogs=[found(), found(gaia_answer(BARNARD_LINE))])
    here = (GAIA, 269.452, 4.693, 0.1)

    first, again, later = ask(sites, here, here, here, clock=lambda: 3600.0 * next(hours))

    assert again is first
    assert len(later.sources) == 1
    assert len(sites.requests) == 2


def test_the_oldest_answers_are_forgotten():
    sites = Sites(catalogs=[found(), found(gaia_answer(FAINT_LINE)), found()])
    here, there = (GAIA, 269.452, 4.693, 0.1), (GAIA, 10.0, -5.0, 0.1)

    ask(sites, here, there, here, remembered=1)

    assert len(sites.requests) == 3


@pytest.mark.parametrize(
    "failure",
    [httpx2.Response(500), httpx2.ReadTimeout("slow"), httpx2.ConnectError("refused")],
)
def test_a_mirror_answers_when_the_first_site_fails(failure):
    sites = Sites(catalogs=[failure], mirror=[found(ALLWISE_ANSWER)])

    [cone] = ask(sites, (ALLWISE, 269.452, 4.693, 0.07))

    assert [request.url.host for request in sites.requests] == [
        "catalogs.example",
        "mirror.example",
    ]
    assert dict(sites.requests[1].url.params)["-sort"] == "W2mag"
    assert len(cone.sources) == 2


def test_a_site_that_reports_a_failure_inside_its_answer_is_passed_over():
    unreachable = found(REFUSED_ANSWER.replace("Table 'nothing'", "The database is not"))
    sites = Sites(catalogs=[unreachable], mirror=[found()])

    [cone] = ask(sites, (GAIA, 269.452, 4.693, 0.1))

    assert len(sites.requests) == 2
    assert len(cone.sources) == 3


def test_every_site_reporting_a_failure_is_told_as_unavailable():
    sites = Sites(catalogs=[found(REFUSED_ANSWER)] * 2, mirror=[found(REFUSED_ANSWER)] * 2)

    with pytest.raises(UpstreamUnavailable) as failure:
        ask(sites, (GAIA, 269.452, 4.693, 0.1))

    assert failure.value.reason == "refused: Table 'nothing' does not exist in catalog: I/355"


def test_the_sites_are_asked_a_second_time_before_giving_up():
    sites = Sites(catalogs=[httpx2.Response(503), found()], mirror=[httpx2.Response(404)])

    [cone] = ask(sites, (GAIA, 269.452, 4.693, 0.1))

    assert [request.url.host.split(".")[0] for request in sites.requests] == [
        "catalogs",
        "mirror",
        "catalogs",
    ]
    assert len(cone.sources) == 3


def test_no_site_answering_is_told_as_unavailable():
    sites = Sites(catalogs=[httpx2.Response(502)] * 2, mirror=[httpx2.ReadTimeout("slow")] * 2)

    with pytest.raises(UpstreamUnavailable) as failure:
        ask(sites, (GAIA, 269.452, 4.693, 0.1))

    assert failure.value.retry_after_s == 10
    assert failure.value.public == "The catalog service did not answer. Try again in a moment."
    assert "time limit" in failure.value.reason
